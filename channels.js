'use strict';

const channelGroups = [
  {name:'总部渠道', style:'headquarters', codes:['R1','R2','R4','R6','R9','R11']},
  {name:'非总部渠道', style:'local', codes:['R3','R5','R8','R10']},
];
const channelGroupIndex = new Map(channelGroups.flatMap((group, i) => group.codes.map(code => [code,i])));

function channelCode(label) {
  const code = compactText(label).toUpperCase().match(/^R\d+/)?.[0];
  return channelGroupIndex.has(code) ? code : 'other';
}
function channelCounts() {
  return Object.fromEntries(metricKeys.map(key => [key,0]));
}
function summarizeChannels(r) {
  const byStore = new Map();
  const other = channelCounts();
  let covered = 0;
  for (const row of r.data) {
    const allocation = row.channelFunnel;
    if (!allocation) continue;
    covered++;
    if (!byStore.has(row.id)) byStore.set(row.id, channelGroups.map(channelCounts));
    const groups = byStore.get(row.id);
    for (const [code, counts] of Object.entries(allocation)) {
      const group = groups[channelGroupIndex.get(code)] ?? other;
      for (const key of metricKeys) group[key] += counts[key];
    }
  }
  return {covered, other, byStore};
}
function channelCells(counts) {
  return stages.map((stage, i) => {
    if (!counts) return '<td class="muted">—</td>';
    return '<td><b>' + number(counts[stage.key]) + '</b>' +
      (i ? '<small>' + rate(counts[stage.key],counts.leads) + '</small>' : '') + '</td>';
  }).join('');
}
function storeChannelTable(r, byStore) {
  const stores = r.detail.slice().sort((a,b) => a.city.localeCompare(b.city,'zh-CN') ||
    a.name.localeCompare(b.name,'zh-CN') || compareId(a,b));
  const groupHeaders = channelGroups.map(group => '<th colspan="' + stages.length + '" scope="colgroup" class="' +
    group.style + '">' + group.name + '<span class="channel-codes">（' + group.codes.join('、') + '）</span></th>').join('');
  const stageHeaders = stages.map(stage => '<th scope="col">' + stage.name + '</th>').join('');
  const rows = stores.map(store => {
    const groups = byStore.get(store.id);
    return '<tr><th scope="row">' + html(store.name) + (r.cityNames.length > 1 ? '<small>' + html(store.city) + '</small>' : '') +
      '</th>' + channelGroups.map((_, i) => channelCells(groups?.[i])).join('') + '</tr>';
  }).join('');
  return '<div class="table-scroll"><table class="channel-table channel-store-table" aria-label="门店渠道分组对比">' +
    '<colgroup span="1"></colgroup>' + channelGroups.map(() => '<colgroup span="' + stages.length + '"></colgroup>').join('') +
    '<thead><tr><th rowspan="2" scope="col">门店</th>' + groupHeaders + '</tr><tr>' + stageHeaders.repeat(channelGroups.length) +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function renderChannelFunnel(r) {
  const {covered, other, byStore} = summarizeChannels(r);
  const notes = [];
  if (!covered) {
    notes.push('该范围暂无渠道明细，请使用含渠道列的销售转化漏斗分析表及对应的数据详情重新导入。');
  } else if (covered < r.data.length) {
    notes.push('已覆盖 ' + covered + '/' + r.data.length + ' 条门店日记录，渠道数值为已覆盖记录合计。');
  }
  if (metricKeys.some(key => other[key] !== 0)) {
    notes.push('未归入两类的记录另含' + stages.map(stage => stage.name + ' ' + number(other[stage.key])).join('、') + '。');
  }
  const body = (notes.length ? '<p class="channel-notice">' + notes.join(' ') + '</p>' : '') + storeChannelTable(r,byStore);
  return panel('门店各渠道的数据漏斗', '到店率、试驾率和锁单率均以该门店对应渠道分组的线索数为基数',
    '<span class="subtle">' + r.detail.length + ' 家门店</span>', body);
}
