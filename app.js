'use strict';

const stages = [
  { key: 'leads', name: '线索', icon: 'lead' },
  { key: 'visits', name: '到店', icon: 'visit' },
  { key: 'drives', name: '试驾', icon: 'drive' },
  { key: 'orders', name: '锁单', icon: 'order' },
];
const metrics = [
  { name: '线索按时跟进率', num: 'onTime', den: 'leads', weight: .25, percent: true,
    issue: '线索跟进不及时', action: '按班次核查超时线索，给未接单线索设置二次分配和班末确认。' },
  { name: '试驾 24H 回访率', num: 'revisited', den: 'eligible', weight: .15, percent: true,
    issue: '试驾后回访不足', action: '从试驾明细核对待回访客户，设定当班责任人，并在 24 小时到期前提醒。' },
  { name: '平均外呼次数', num: 'calls', den: 'leads', weight: .1, unit: '次',
    issue: '平均外呼次数偏低', action: '分开复盘首呼和二次外呼，给未接通线索安排下一次合适的联系时段。' },
  { name: '平均响应时长', num: 'responseMinutes', den: 'responded', weight: .2, lower: true, unit: '分钟',
    issue: '平均响应时间偏长', action: '先查超时线索是否集中在午间、交接班或分配后未接单，再安排对应时段的值班和超时转派。' },
  { name: '有效通话率', num: 'effective', den: 'calls', weight: .3, percent: true,
    issue: '有效通话率偏低', action: '抽听未形成有效沟通的通话，核查号码质量、拨打时段和开场话术，次日复盘有效通话率。' },
];
const $ = id => document.getElementById(id);
const number = value => value.toLocaleString('zh-CN');
const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const formatDate = value => value.slice(5).replace('-', '/');
const intakeLabels = {daily:'经营日报', weekly:'经营周报', history:'历史归档', source:'数据接入'};
const state = {city:'', region:'', subregion:'', date:'', trend:'leads', archiveStatus:'loading'};
const html = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const compareId = (a,b) => String(a.id).localeCompare(String(b.id), 'zh-CN', {numeric:true});

function shift(date, days) {
  const result = new Date(date + 'T00:00:00Z');
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
const lastDate = () => actualDates().at(-1) || '';
const earliestDate = () => actualDates()[0] || '';

function value(row, metric) {
  if (metric.key) return row[metric.key] ?? null;
  return row[metric.den] ? row[metric.num] / row[metric.den] : null;
}
function rate(n, d) { return d ? (100 * n / d).toFixed(1) + '%' : '—'; }
function metricText(metric, v) {
  if (v === null) return '—';
  return metric.percent ? (100 * v).toFixed(2) + '%' : v.toFixed(2);
}
function metricFull(metric, v) {
  return metricText(metric, v) + (metric.unit && v !== null ? ' ' + metric.unit : '');
}
function matchingCities() {
  return actualOrganizations().filter(c => (!state.region || c.region === state.region) && (!state.subregion || c.subregion === state.subregion) && (!state.city || c.name === state.city));
}
function delta(current, previous, suffix = '') {
  if (previous === null) return '<span class="muted">—</span>';
  const diff = current - previous;
  const label = diff === 0 ? '持平' : (diff > 0 ? '+' : '−') + number(Math.abs(diff)) + suffix;
  return '<span class="delta ' + (diff === 0 ? 'muted' : diff > 0 ? 'good' : 'bad') + '">' + label + '</span>';
}
function panel(title, description, right, body) {
  return '<section class="panel"><div class="panel-header"><div><h2>' + title + '</h2>' +
    (description ? '<p>' + description + '</p>' : '') + '</div>' + (right || '') + '</div>' + body + '</section>';
}
function rank(i) {
  return '<span class="rank ' + (i < 3 ? 'medal' : '') + '">' + (i + 1) + '</span>';
}
function dateRange(start, end) {
  return start === end ? start : start + ' 至 ' + end;
}
function kpis(r) {
  return '<div class="kpis">' + stages.map((stage, i) => {
    const current = r.sum[stage.key];
    return '<article class="kpi"><div class="kpi-top">' + stage.name + '数<span class="kpi-icon">' + icon(stage.icon) +
      '</span></div><strong class="kpi-number">' + number(current) + '</strong><div class="kpi-meta">' +
      delta(current, r.before ? r.before[stage.key] : null) + '<span>' + (r.view === 'daily' ? '较前日' : '较上周同期') +
      (i ? ' · ' + stage.name + '率 ' + rate(current,r.sum.leads) : '') + '</span></div></article>';
  }).join('') + '</div>';
}
function trend(r) {
  const start = r.view === 'daily' ? shift(r.end,-6) : r.start;
  const days = actualDates().filter(date=>date>=start && date<=r.end);
  const values = days.map(date => {
    const rows = actualSeries(date,date,r.cityNames);
    return rows.length ? rows.reduce((sum,row)=>sum+row[state.trend],0) : null;
  });
  if (!days.length || values.every(v=>v===null)) return panel('趋势','','','<div class="empty">当前范围暂无归档数据。</div>');
  const peak = Math.max(...values,1);
  const power = 10 ** Math.floor(Math.log10(peak / 3));
  const step = Math.ceil(peak / 3 / power) * power;
  const max = step * 3;
  const coords = values.flatMap((v,i) => v === null ? [] : [[days.length === 1 ? 296 : 46 + i * 510/(days.length-1), 138 - 119*v/max,i]]);
  const points = coords.map(([x,y]) => x + ',' + y).join(' ');
  const label = state.trend === 'leads' ? '线索' : '锁单';
  const chart = '<svg class="chart" role="img" aria-label="' + label + '趋势，' + coords.map(([, ,i]) => formatDate(days[i]) + ' ' + values[i]).join('，') + '" viewBox="0 0 580 165">' +
    '<defs><linearGradient id="chart-area" x2="0%" y2="100%"><stop offset="0%" stop-color="#3b6df4" stop-opacity=".19"/><stop offset="100%" stop-color="#3b6df4" stop-opacity=".025"/></linearGradient></defs>' +
    [0,1,2,3].map(i => '<line class="chart-grid" x1="46" x2="556" y1="' + (138-119*i/3) + '" y2="' + (138-119*i/3) + '"/><text x="38" y="' + (142-119*i/3) + '" text-anchor="end">' + number(step*i) + '</text>').join('') +
    '<polygon fill="url(#chart-area)" stroke="none" points="' + coords[0][0] + ',138 ' + points + ' ' + coords.at(-1)[0] + ',138"/><polyline class="chart-line" points="' + points + '"/>' +
    coords.map(([x,y,i]) => '<circle class="chart-point" cx="' + x + '" cy="' + y + '" r="3.4"><title>' + formatDate(days[i]) + ' · ' + number(values[i]) + '</title></circle><text x="' + x + '" y="157" text-anchor="middle">' + formatDate(days[i]) + '</text>').join('') + '</svg>';
  const toggle = '<div class="toggle" aria-label="趋势指标">' + [['leads','线索'],['orders','锁单']].map(([key,name]) => '<button type="button" data-trend="' + key + '" aria-pressed="' + (key === state.trend) + '">' + name + '</button>').join('') + '</div>';
  return panel(r.view === 'daily' ? '近 7 日趋势' : '本周每日趋势', '仅显示已有记录的统计日', toggle, chart);
}
function funnel(r) {
  if (r.sum.orders < 0) return panel('经营漏斗','底表锁单量为负，保留原值','','<div class="stages">' +
    stages.map(stage=>'<div class="stage-label"><span>'+stage.name+'</span><b>'+number(r.sum[stage.key])+'</b></div>').join('') + '</div>');
  const bars = stages.map(stage => {
    const ratio = r.sum.leads ? r.sum[stage.key]/r.sum.leads : 0;
    return '<div><div class="stage-label"><span>' + stage.name + '</span><span><b>' + number(r.sum[stage.key]) + '</b> <span class="muted">' +
      rate(r.sum[stage.key], r.sum.leads) + '</span></span></div><div class="track"><span class="fill" style="width:' + Math.max(0,Math.min(100,ratio*100)) + '%"></span></div></div>';
  }).join('');
  return panel('经营漏斗','以线索数为基数', '', '<div class="stages">' + bars + '</div>');
}
function footerRow(label, cells) {
  return '<tr><td></td><td>' + html(label) + '</td>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>';
}
function cityAverageRows(byCity, cellsForCity) {
  return Array.from(byCity, ([city, rows]) => {
    const label = byCity.size === 1 ? '城市均值' : city + '均值';
    return footerRow(label, cellsForCity(rows));
  }).join('');
}
function conversionTable(r) {
  const rows = r.detail.slice().sort((a,b) => b.orders-a.orders || b.drives-a.drives || b.visits-a.visits || b.leads-a.leads || compareId(a,b));
  const name = row => html(row.name) + (r.cityNames.length > 1 ? ' · ' + html(row.city) : '');
  const body = rows.map((row,i) => '<tr><td>' + rank(i) + '</td><td><b>' + name(row) + '</b></td>' + stages.map((stage,j) =>
    '<td><b>' + number(row[stage.key]) + '</b><small>' + delta(row[stage.key], row.before ? row.before[stage.key] : null) +
    (j ? ' <span class="muted">' + rate(row[stage.key],row.leads) + '</span>' : '') + '</small></td>').join('') + '</tr>').join('');
  const foot = cityAverageRows(Map.groupBy(r.detail, row => row.city), rows => {
    const leadTotal = rows.reduce((sum, row) => sum + row.leads, 0);
    return stages.map((stage, i) => {
      const total = i === 0 ? leadTotal : rows.reduce((sum, row) => sum + row[stage.key], 0);
      const average = (total / rows.length).toLocaleString('zh-CN', {minimumFractionDigits:1, maximumFractionDigits:1});
      return average + (i ? '<small>' + rate(total, leadTotal) + '</small>' : '');
    });
  });
  const comparison = r.view === 'daily' ? '较前日差值' : '较上周同期差值';
  const headings = stages.map((stage, i) => '<th scope="col">' + stage.name + '<small>' + comparison +
    (i ? '、' + stage.name + '率' : '') + '</small></th>').join('');
  return panel('门店数据漏斗', '按锁单数排序',
    '<span class="subtle">' + rows.length + ' 家门店</span>',
    '<div class="table-scroll"><table class="conversion-table" aria-label="门店数据漏斗"><thead><tr>' +
    '<th scope="col">名次</th><th scope="col">门店</th>' + headings +
    '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>');
}
function cityProcessAverages(rows, definitions) {
  return new Map(Array.from(Map.groupBy(rows, row => row.city), ([city, stores]) => [
    city, definitions.map(metric => {
      const observed = stores.map(store => value(store, metric)).filter(Number.isFinite);
      return observed.length ? observed.reduce((sum, v) => sum + v, 0) / observed.length : null;
    }),
  ]));
}
function processGap(metric, reading, average) {
  if (reading === null || average === null) return null;
  const difference = metric.lower ? reading - average : average - reading;
  return Math.abs(difference) < .000001 ? 0 : difference;
}
function diagnosticGap(row, metric, average) {
  if (metric.percent && !metric.key && row[metric.den] < 5) return null;
  return processGap(metric, value(row, metric), average);
}
function processTable(r, definitions, averages) {
  const distributions = definitions.map(metric => {
    const observed = r.detail.map(row => value(row,metric)).filter(v => v !== null);
    return { min:Math.min(...observed), max:Math.max(...observed) };
  });
  const score = row => definitions.reduce((sum, metric, i) => {
    const v = value(row, metric);
    const {min,max} = distributions[i];
    const scale = v === null || max === min ? .5 : metric.lower ? (max-v)/(max-min) : (v-min)/(max-min);
    return sum + metric.weight * scale;
  }, 0);
  const rows = r.detail.slice().sort((a,b) => score(b) - score(a) || compareId(a,b));
  const body = rows.map((row,i) => '<tr><td>' + rank(i) + '</td><td><b>' + html(row.name) +
    (r.cityNames.length > 1 ? ' · ' + html(row.city) : '') + '</b></td>' + definitions.map((metric, i) => {
      const v = value(row,metric);
      const gap = processGap(metric, v, averages.get(row.city)[i]);
      const tone = gap > 0 ? 'bad' : gap < 0 ? 'good' : 'muted';
      return '<td><b class="' + tone + '">' + metricText(metric,v) + '</b></td>';
    }).join('') + '</tr>').join('');
  const foot = cityAverageRows(averages, values => values.map((average, i) => metricText(definitions[i], average)));
  const method = '门店线索按时跟进率取漏斗分析表 V 列口径，跨渠道或日期按应跟进任务量加权。其余过程项的门店周报暂用有值日期的简单平均。渠道回访率不一致时该门店日显示 —。';
  const legend = '绿色优于同城均值，红色弱于同城均值';
  return panel('门店过程指标',html(actualMetadata(r)) + ' · ' + legend,'',
    '<div class="table-scroll"><table aria-label="门店过程指标"><thead><tr><th>名次</th><th>门店</th>' +
    definitions.map(m => '<th scope="col">' + m.name + (m.unit ? '（' + m.unit + '）' : '') + '</th>').join('') + '</tr></thead><tbody>' +
    body + '</tbody><tfoot>' + foot + '</tfoot></table></div><details><summary>查看统计口径</summary><p class="note">城市均值按各指标有值的门店等权计算，有效的 0 值参与平均。' + method + '</p></details>');
}
function diagnoses(r, definitions, averages) {
  const issues = r.detail.flatMap(row => definitions.flatMap((metric, i) => {
    const average = averages.get(row.city)[i];
    const gap = diagnosticGap(row, metric, average);
    if (!(gap > 0)) return [];
    const severity = gap / (Math.abs(average) || gap);
    return [{row,metric,i,gap,severity}];
  })).sort((a,b) => b.severity-a.severity);
  const focus = issues.slice(0,6);
  const averagesByDay = r.view === 'weekly' ? new Map(
    Array.from(Map.groupBy(r.data, day => day.date), ([date, rows]) => [date, cityProcessAverages(rows, definitions)])
  ) : null;
  const scope = JSON.stringify([r.view,r.start,r.end,state.region,state.subregion,state.city]);
  visibleDiagnoses = [];
  const cards = focus.map(({row,metric,i,gap,severity}, index) => {
    const v = value(row,metric);
    const was = row.before ? value(row.before,metric) : null;
    const change = was === null ? '' : ' · ' + (r.view === 'daily' ? '前日 ' : '上周同期 ') + metricFull(metric,was);
    const severityLabel = severity >= .35 ? '重点关注' : '提醒';
    const gapText = metric.percent ? (gap*100).toFixed(2) + ' 个百分点' : gap.toFixed(2) + ' ' + metric.unit;
    const misses = averagesByDay ? r.data.filter(day => {
      if (day.id !== row.id) return false;
      const average = averagesByDay.get(day.date).get(day.city)[i];
      return diagnosticGap(day, metric, average) > 0;
    }).length : 0;
    const store = row.city + ' · ' + row.name;
    const key = JSON.stringify([row.id,metric.key || metric.num]);
    const reading = metricFull(metric,v);
    const comparison = '，' + (metric.lower ? '高于' : '低于') + '同城均值 ' + gapText +
      change + (r.view === 'weekly' ? ' · ' + misses + '/' + r.covered + ' 天触发' : '');
    const edit = diagnosisEdits.get(scope)?.get(key);
    const content = edit || {title:metric.issue, observation:reading + comparison, action:metric.action};
    visibleDiagnoses.push({scope,key,store,...content});
    return '<article class="diagnosis ' + (severity < .35 ? 'warning' : '') + '"><div class="diagnosis-top"><div>' +
      '<span class="label">' + severityLabel + '</span><span class="issue-store">' + html(store) +
      '</span></div><button type="button" class="diagnosis-edit link" data-export-control data-diagnosis="' + index +
      '" aria-label="' + html('编辑' + store + ' · ' + content.title) + '">编辑</button></div><h3>' + html(content.title) +
      '</h3><p class="diagnosis-copy">' + (edit ? html(content.observation) : '<b>' + html(reading) + '</b>' + html(comparison)) +
      '</p><p class="diagnosis-copy"><b>改善动作</b>　' + html(content.action) + '</p></article>';
  }).join('');
  return panel('异常诊断与改善意见',
    issues.length ? '按与同城均值的差距展示前 ' + focus.length + ' 条异常' + '，缺失指标不参与诊断' : '按同城均值比较',
    '<span class="subtle">' + new Set(issues.map(i=>i.row.id)).size + ' 家门店触发</span>',
    cards ? '<div class="diagnostics">' + cards + '</div>' : '<div class="empty">当前统计范围内暂无触发的异常。</div>');
}
function renderHistory() {
  const cityNames = matchingCities().map(c => c.name);
  const rows = actualDates().sort().reverse().filter(d => d <= state.date).map(date => {
    const data = actualSeries(date,date,cityNames);
    if (!data.length) return '';
    const sum = actualTotals(data);
    return '<tr><td><button class="link" type="button" data-history="' + date + '">' + date + '</button></td><td>' +
      cityNames.join('、') + '</td><td>' + data.length + ' 家</td><td>' + number(sum.leads) + '</td><td>' + number(sum.orders) + '</td><td><button class="link" type="button" data-history="' + date + '">查看日报</button></td></tr>';
  }).join('');
  if (!rows) return panel('已归档日报','','','<div class="empty">当前筛选范围内没有归档。</div>');
  return panel('已归档日报','按日期倒序排列，点击日期打开日报','',
    '<div class="table-scroll"><table class="history-table" aria-label="归档日报"><thead><tr><th>统计日期</th><th>城市</th><th>覆盖门店</th><th>线索</th><th>锁单</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>');
}
function renderSource() {
  return panel('导入两份底表','四城门店指标保存在当前浏览器。慢闪店按底表的「渠道类型」剔除。','',
    actualSourceForm());
}
function currentView() {
  const view = location.hash.slice(1);
  return Object.hasOwn(intakeLabels,view) ? view : 'daily';
}
function render() {
  const view = currentView();
  const shownCities = matchingCities();
  const organizations = actualOrganizations();
  visibleDiagnoses = [];
  const name = state.city || (shownCities.length === 1 ? shownCities[0].name : '四城');
  const isReport = view === 'daily' || view === 'weekly';
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent = (view === 'source' ? '数据管理' : '经营报表') + ' / ' + intakeLabels[view];
  $('title').textContent = isReport ? name + intakeLabels[view] : intakeLabels[view];
  $('filters').hidden = view === 'source' || !actualArchive.size;
  $('download').hidden = true;
  organizationPickers.region([...new Set(organizations.map(c => c.region))], state.region);
  organizationPickers.subregion([...new Set(organizations.filter(c => !state.region || c.region === state.region).map(c => c.subregion))], state.subregion);
  organizationPickers.city([...new Set(organizations.filter(c => (!state.region || c.region === state.region) && (!state.subregion || c.subregion === state.subregion)).map(c => c.name))], state.city);
  $('date-label').textContent = view === 'weekly' ? '选择所在周' : view === 'history' ? '截止日期' : '统计日期';
  $('date-input').min = earliestDate();
  $('date-input').max = lastDate();
  $('date-input').value = state.date;
  if (state.archiveStatus === 'loading') {
    $('subtitle').textContent = '';
    $('content').innerHTML = panel('正在读取本机归档','','','');
    return;
  }
  if (state.archiveStatus === 'failed') {
    $('subtitle').textContent = '';
    $('content').innerHTML = panel('暂时无法读取本机归档','','','<button type="button" class="button outline" id="retry-archive">重试</button>');
    return;
  }
  if (isReport) {
    if (!state.date) {
      $('subtitle').textContent = '';
      $('content').innerHTML = panel('暂无经营数据','','','<div class="empty">请前往<a class="link" href="#source">数据接入</a>导入两份底表。</div>');
      return;
    }
    const r = actualReport(view);
    $('subtitle').textContent = dateRange(r.start,r.end) + '　·　' + r.detail.length + ' 家门店' +
      (view === 'weekly' ? '　·　已归档 ' + r.covered + '/7 天' : '');
    if (!r.detail.length || !r.canTotal) {
      $('content').innerHTML = !r.detail.length ?
        panel('经营数据','','','<div class="empty">当前范围暂无归档数据，请切换日期或城市。</div>') :
        panel('周报统计范围待确认','','','<div class="empty">该周有底表尚未确认是否按日取数。若漏斗表仅统计单日，请在<a class="link" href="#source">数据接入</a>重新导入对应日期并标记「仅统计当日」。</div>');
      return;
    }
    $('download').hidden = false;
    const definitions = r.metrics;
    const averages = cityProcessAverages(r.detail, definitions);
    const channels = view === 'weekly' ? renderChannelFunnel(r) : '';
    $('content').innerHTML = kpis(r) + '<div class="overview">' + trend(r) + funnel(r) + '</div>' +
      '<div id="report-sections" class="report-sections">' + conversionTable(r) + channels +
      processTable(r, definitions, averages) + diagnoses(r, definitions, averages) + '</div>';
  } else {
    $('subtitle').textContent = view === 'history' ? '按组织范围和日期查找已保存的日报' : '两份报表统一取数、匹配门店并保存每日快照';
    $('content').innerHTML = view === 'history' ? renderHistory() : renderSource();
  }
}
let toastTimer;
function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
$('content').addEventListener('submit',event => {
  if (event.target.id === 'import-form') importReport(event);
});
const organizationPickers = Object.fromEntries(
  [['region','大区'],['subregion','小区'],['city','城市']].map(([id,label]) =>
    [id,createFilterPicker($(id),label,'全部' + label,value => {
      state[id] = value;
      if (id === 'region') state.subregion = '';
      if (id !== 'city') state.city = '';
      render();
    })])
);
$('date-input').addEventListener('change', event => {
  const choice = event.target.value;
  if (actualArchive.has(choice)) state.date = choice;
  else notify('该日期暂无归档，请选择已有数据的日期');
  render();
});
$('reset').addEventListener('click', () => {
  Object.assign(state, {city:'',region:'',subregion:'',date:lastDate(),trend:'leads'});
  render();
});
$('download').addEventListener('click', exportReportImage);
$('content').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'retry-archive') refreshArchive();
  if (button.hasAttribute('data-diagnosis')) openDiagnosis(Number(button.dataset.diagnosis));
  if (button.dataset.trend) {
    state.trend = button.dataset.trend;
    render();
    document.querySelector('[data-trend="' + state.trend + '"]').focus();
  }
  if (button.dataset.history) {
    state.date = button.dataset.history;
    location.hash = 'daily';
    render();
    window.scrollTo(0,0);
  }
});
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0,0);
});
$('diagnosis-form').addEventListener('submit', saveDiagnosisEdit);
$('diagnosis-cancel').addEventListener('click', () => {
  if (!$('diagnosis-save').disabled) $('diagnosis-dialog').close();
});
$('diagnosis-dialog').addEventListener('cancel', event => {
  if ($('diagnosis-save').disabled) event.preventDefault();
});
refreshArchive();
