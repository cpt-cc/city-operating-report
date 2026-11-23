'use strict';

const actualArchive = new Map();
const diagnosisEdits = new Map();
let visibleDiagnoses = [];
let activeDiagnosis;

function rememberDiagnosis(scope,key,edit) {
  if (!diagnosisEdits.has(scope)) diagnosisEdits.set(scope,new Map());
  diagnosisEdits.get(scope).set(key,edit);
}
async function refreshArchive() {
  state.archiveStatus = 'loading';
  render();
  try {
    const {reports,edits} = await archiveApi('archive');
    actualArchive.clear();
    for (const [date,entry] of reports) actualArchive.set(date,entry);
    diagnosisEdits.clear();
    for (const [scope,key,edit] of edits) rememberDiagnosis(scope,key,edit);
    if (!availableDates().includes(state.date)) state.date = lastDate();
    state.archiveStatus = 'ready';
  } catch (error) {
    state.archiveStatus = 'failed';
  }
  render();
}
function openDiagnosis(index) {
  const chosen = visibleDiagnoses[index];
  if (!chosen) return;
  activeDiagnosis = chosen;
  $('diagnosis-store').textContent = chosen.store;
  const form = $('diagnosis-form');
  for (const field of ['title','observation','action']) form.elements.namedItem(field).value = chosen[field];
  $('diagnosis-error').textContent = '';
  $('diagnosis-dialog').showModal();
}
async function saveDiagnosisEdit(event) {
  event.preventDefault();
  if (!activeDiagnosis) return;
  const {scope,key} = activeDiagnosis;
  const form = event.target;
  const edit = Object.fromEntries([...new FormData(form)].map(([key,value])=>[key,value.trim()]));
  const save = $('diagnosis-save');
  const cancel = $('diagnosis-cancel');
  $('diagnosis-error').textContent = '';
  save.disabled = cancel.disabled = true;
  try {
    await archiveApi('diagnoses',{scope,key,edit});
    rememberDiagnosis(scope,key,edit);
    $('diagnosis-dialog').close();
    activeDiagnosis = undefined;
    render();
    notify('诊断已保存，可导出图片');
  } catch (error) {
    $('diagnosis-error').textContent = error.message || '保存失败，请重试。';
  } finally {
    save.disabled = cancel.disabled = false;
  }
}
const observationKeys = ['revisitRate','followAverage','responseAverage','callRate'];
const weekKey = date => 'week:' + date;
const actualDates = () => [...actualArchive.keys()].filter(key => !key.startsWith('week:')).sort();
const availableDates = () => [...actualArchive.keys()].map(key => key.replace(/^week:/,'')).sort();
const actualOrganizations = () => [...new Map([...actualArchive.values()].flatMap(entry => entry.rows)
  .map(row => [[row.city,row.region,row.subregion].join('|'),{name:row.city,region:row.region,subregion:row.subregion}])).values()];

function actualMetrics() {
  return [
    {...metrics[0], num:'onTime',den:'tasks'},
    {...metrics[1], name:'试驾24H回访率',key:'revisitRate'},
    {...metrics[3], name:'平均首触响应时长',key:'responseAverage',issue:'首触响应时间偏长',
      action:'按时段抽查首触较慢的线索，核对分配时间、接单记录和值班安排。'},
    {...metrics[4], name:'60s有效通话率',key:'callRate',issue:'60s有效通话率偏低'},
    {...metrics[2], name:'客户平均跟进次数',key:'followAverage',unit:'次/人',issue:'客户平均跟进次数偏低',
      action:'抽查跟进记录，确认未接通和未回复的客户是否安排了下一次跟进。'},
  ];
}
function actualWindow(view) {
  if (view === 'daily') return {start:state.date,end:state.date,plan:1};
  const day = new Date(state.date + 'T00:00:00Z').getUTCDay();
  const start = shift(state.date,-((day+6)%7));
  return {start,end:shift(start,6),plan:7};
}
function actualSeries(start, end, cityNames) {
  return actualDates().filter(date=>date>=start && date<=end)
    .flatMap(date=>actualArchive.get(date).rows.filter(row=>cityNames.includes(row.city) &&
      (!state.region || row.region === state.region) && (!state.subregion || row.subregion === state.subregion))
      .map(row=>({...row,date})));
}
function actualTotals(rows) {
  const summed = Object.fromEntries([...metricKeys,'onTime','tasks'].map(k => [k,rows.reduce((sum,row)=>sum+row[k],0)]));
  for (const key of observationKeys) {
    const values = rows.map(row=>row[key]).filter(Number.isFinite);
    summed[key] = values.length ? values.reduce((sum,v)=>sum+v,0) / values.length : null;
  }
  return summed;
}
function actualReport(view) {
  const {start,end,plan} = actualWindow(view);
  const dates = actualDates().filter(date=>date>=start && date<=end);
  const cityNames = matchingCities().map(c=>c.name);
  const weeklyEntry = view === 'weekly' ? actualArchive.get(weekKey(start)) : null;
  const data = weeklyEntry ? weeklyEntry.rows.filter(row=>cityNames.includes(row.city) &&
    (!state.region || row.region === state.region) && (!state.subregion || row.subregion === state.subregion))
    .map(row=>({...row,date:start})) : actualSeries(start,end,cityNames);
  const isSingleDay = date => actualArchive.get(date)?.period === 'day';
  const canTotal = !!weeklyEntry || view === 'daily' || dates.every(isSingleDay);
  const compareDays = dates.map(date=>shift(date,view==='daily'?-1:-7));
  const previousWeek = weeklyEntry ? actualArchive.get(weekKey(shift(start,-7))) : null;
  const hasComparison = weeklyEntry ? !!previousWeek : dates.length > 0 && dates.every(isSingleDay) && compareDays.every(isSingleDay);
  const previous = previousWeek ? previousWeek.rows.filter(row=>cityNames.includes(row.city) &&
    (!state.region || row.region === state.region) && (!state.subregion || row.subregion === state.subregion)) :
    hasComparison ? compareDays.flatMap(date=>actualSeries(date,date,cityNames)) : [];
  const byStore = Map.groupBy(data,row=>row.id);
  const beforeStore = Map.groupBy(previous,row=>row.id);
  const detail = Array.from(byStore,([id,rows]) => ({
    ...rows.at(-1), ...actualTotals(rows),
    before:beforeStore.has(id) ? actualTotals(beforeStore.get(id)) : null,
  }));
  return {view,start,end,plan,data,dates,cityNames,detail,covered:dates.length, directWeek:!!weeklyEntry, sum:actualTotals(data),
    canTotal,before:hasComparison && previous.length ? actualTotals(previous) : null,
    metrics:actualMetrics()};
}
function actualMetadata(report) {
  const matched = new Set(report.data.filter(row=>row.matched).map(row=>row.id)).size;
  const inconsistent = report.data.filter(row=>row.revisitConflict).length;
  const connection = '数据详情匹配 ' + matched + '/' + report.detail.length + ' 家门店';
  const dates = report.directWeek ? [report.start + ' 至 ' + report.end] : [...new Set(report.dates.map(date=>actualArchive.get(date).detailDate))];
  const detailPeriod = dates.length ? ('数据详情统计日 ' + (dates.length===1 ? dates[0] : dates[0] + ' 至 ' + dates.at(-1))) : '';
  const drill = inconsistent ? ' · ' + inconsistent + ' 条门店日记录的渠道回访率不一致，待确认加权分母' : '';
  return [connection,detailPeriod].filter(Boolean).join(' · ') + drill;
}
function actualSourceForm() {
  return '<form id="import-form" class="import-form"><div class="source-grid">' +
    '<label class="source-card"><b>销售转化漏斗分析表</b><small>新增线索、到店、试驾、锁单、线索按时跟进率、试驾24H回访率</small><input name="sales" type="file" accept=".xlsx" required></label>' +
    '<label class="source-card"><b>数据详情</b><small>平均首触响应时长、60s有效通话率、客户平均跟进次数</small><input name="detail" type="file" accept=".xlsx" required></label></div>' +
    '<div class="import-fields"><label>导入类型<select name="kind" id="import-kind"><option value="daily">日报（单日）</option><option value="weekly">周报（整周）</option></select></label>' +
    '<label>统计开始日<input type="date" name="date" required></label>' +
    '<label id="week-end-label" hidden>统计结束日<input type="date" name="endDate"></label>' +
    '<label id="detail-date-label">数据详情统计日<input type="date" name="detailDate" required></label>' +
    '<label id="period-label">漏斗报表统计范围<select name="period"><option value="unknown">累计或尚未确认</option><option value="day">仅统计当日</option></select></label></div>' +
    '<p class="note">导入周报时，两张表须按同一周的周一至周日导出。整周数据独立归档，不与日报重复加总。</p>' +
    '<div class="sync-footer"><button class="button primary" type="submit">导入并查看日报</button>' +
    '<span class="subtle" role="status" id="import-status"></span></div></form>';
}
async function importReport(event) {
  event.preventDefault();
  const form = event.target;
  const status = $('import-status');
  const submit = form.querySelector('button[type=submit]');
  const {sales,detail,date,detailDate,period,kind,endDate} = Object.fromEntries(new FormData(form));
  if (kind === 'weekly' && (!endDate || shift(date,6) !== endDate || new Date(date+'T00:00:00Z').getUTCDay() !== 1)) {
    status.textContent = '请选择同一周的周一至周日。'; return;
  }
  submit.disabled = true;
  status.textContent = '正在读取 Excel 并匹配门店…';
  try {
    const a = await readXlsx(sales,salesColumns,'销售转化漏斗分析表');
    const b = await readXlsx(detail,detailColumns,'数据详情');
    const rows = assembleReport(a,b);
    const entry = {rows,detailDate:kind === 'weekly' ? endDate : detailDate,period:kind === 'weekly' ? 'week' : period,end:kind === 'weekly' ? endDate : date};
    const key = kind === 'weekly' ? weekKey(date) : date;
    if (actualArchive.has(key) && !confirm('该日期已有归档，重新导入会覆盖它。确定继续吗？')) { submit.disabled=false; status.textContent='已取消导入。'; return; }
    await archiveApi('archive',{date:key,entry});
    actualArchive.set(key,entry);
    Object.assign(state,{date,city:'',region:'',subregion:''});
    location.hash = kind === 'weekly' ? 'weekly' : 'daily';
    render();
    notify('已导入 ' + rows.length + ' 家门店，已保存到当前浏览器');
  } catch (error) {
    status.textContent = error.message || '读取失败，请核对文件格式。';
    submit.disabled = false;
  }
}
