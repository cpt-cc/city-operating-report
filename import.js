'use strict';

const salesColumns = {
  region:'大区', subregion:'小区', city:'城市', code:'专营店编码', name:'专营店', storeType:'渠道类型', channel:'渠道',
  leads:'新增线索量', visits:'新增到店量', drives:'试驾量', orders:'锁单量',
  tasks:'应跟进任务量', salesRate:'线索按时跟进率', revisitRate:'试驾24H回访率',
};
const detailColumns = {
  region:'大区', subregion:'小区', name:'专营店名称', responseAverage:'平均首触响应时长（分钟）',
  callRate:'60s有效通话率', followAverage:'客户平均跟进次数（次/人）',
};
const targetCities = ['苏州','深圳','重庆','武汉'];
const cleanText = value => String(value ?? '').normalize('NFKC').trim();
const compactText = value => cleanText(value).replace(/\s+/g, '');
const organizationKey = row => [row.region,row.subregion,row.name].map(compactText).join('|');
const metricKeys = ['leads','visits','drives','orders'];
const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function readXlsx(file, columns, label) {
  let zip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
  catch (error) { throw new Error(label + '无法读取，请使用系统导出的 .xlsx 文件。'); }
  const xml = async (path, required = true) => {
    const entry = zip.file(path);
    if (!entry && !required) return null;
    if (!entry) throw new Error(label + '缺少工作簿内容。');
    const document = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    if (document.getElementsByTagName('parsererror').length) throw new Error(label + '的工作表格式有误。');
    return document;
  };
  const [workbook, relationships, stringTable] = await Promise.all([
    xml('xl/workbook.xml'), xml('xl/_rels/workbook.xml.rels'), xml('xl/sharedStrings.xml',false),
  ]);
  const nodeList = (node,name) => node.getElementsByTagNameNS(namespace,name);
  const texts = node => Array.from(nodeList(node,'t'), part => part.textContent).join('');
  const strings = stringTable ? Array.from(nodeList(stringTable,'si'),texts) : [];
  const paths = new Map(Array.from(relationships.getElementsByTagNameNS('*','Relationship'), r => [r.getAttribute('Id'),r.getAttribute('Target')]));
  function cellValue(cell) {
    const type = cell.getAttribute('t');
    if (type === 'inlineStr') return texts(cell);
    const value = nodeList(cell,'v')[0]?.textContent;
    if (value == null || value === '') return null;
    if (type === 's') return strings[Number(value)] ?? null;
    if (type === 'e') return null;
    if (type === 'str') return value;
    return Number.isFinite(Number(value)) ? Number(value) : value;
  }
  const fields = Object.entries(columns).map(([key,name]) => [key,compactText(name)]);
  for (const sheet of Array.from(nodeList(workbook,'sheet'))) {
    const target = paths.get(sheet.getAttributeNS(relationshipNamespace,'id'));
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const data = await xml(path);
    const rows = nodeList(data,'row');
    const headings = new Map();
    for (let i=0;i<Math.min(8,rows.length);i++) {
      for (const cell of rows[i].children) {
        const heading = compactText(cellValue(cell));
        if (heading) headings.set(heading,cell.getAttribute('r').replace(/\d+/g,''));
      }
      if (fields.every(([,name]) => headings.has(name))) {
        const indices = new Map(fields.map(([key,name]) => [headings.get(name),key]));
        const output = [];
        for (let j=i+1;j<rows.length;j++) {
          const record = {};
          for (const cell of rows[j].children) {
            const key = indices.get(cell.getAttribute('r').replace(/\d+/g,''));
            if (key) record[key] = cellValue(cell);
          }
          output.push(record);
        }
        return output;
      }
    }
  }
  throw new Error(label + '未找到完整表头，请核对所选文件。');
}

function parseNumber(input) {
  const text = cleanText(input).replaceAll(',','');
  if (!text) return null;
  const percent = text.endsWith('%');
  const number = Number(percent ? text.slice(0,-1) : text);
  return Number.isFinite(number) ? number / (percent ? 100 : 1) : null;
}
function assembleReport(salesRows, detailRows) {
  const detail = new Map();
  for (const row of detailRows) {
    if (!cleanText(row.name)) continue;
    const key = organizationKey(row);
    if (detail.has(key)) detail.set(key,null);
    else detail.set(key,row);
  }
  const stores = new Map();
  const slowCodes = new Set(salesRows.filter(row => /慢[闪閃]店/.test(compactText(row.storeType))).map(row => cleanText(row.code)));
  for (const row of salesRows) {
    const city = cleanText(row.city).replace(/市$/,'');
    const code = cleanText(row.code);
    if (!targetCities.includes(city) || !code || slowCodes.has(code)) continue;
    const info = { id:code, code, city, name:cleanText(row.name), region:cleanText(row.region), subregion:cleanText(row.subregion), storeType:cleanText(row.storeType) };
    if (!info.name || !info.region || !info.subregion) throw new Error('漏斗表有门店缺少组织字段，请核对导出。');
    let store = stores.get(code);
    if (!store) {
      store = {...info, ...Object.fromEntries(metricKeys.map(k => [k,0])), onTime:0, tasks:0, revisitRates:new Set(), channels:new Set(), channelFunnel:{}};
      stores.set(code,store);
    }
    if (organizationKey(store) !== organizationKey(info) || store.city !== city) throw new Error('漏斗表同一门店编码对应多个组织或名称。');
    const channel = compactText(row.channel);
    if (store.channels.has(channel)) throw new Error('漏斗表中有重复的门店与渠道，请核对导出粒度。');
    store.channels.add(channel);
    const counts = store.channelFunnel[channelCode(channel)] ??= channelCounts();
    for (const key of metricKeys) {
      const number = parseNumber(row[key]);
      if (number === null) throw new Error('漏斗表有缺失或无法识别的计数，请核对导出。');
      store[key] += number;
      counts[key] += number;
    }
    const salesRate = parseNumber(row.salesRate);
    const taskCount = parseNumber(row.tasks);
    if (salesRate !== null && taskCount > 0) {
      store.onTime += salesRate * taskCount;
      store.tasks += taskCount;
    }
    const revisitRate = parseNumber(row.revisitRate);
    if (revisitRate !== null) store.revisitRates.add(revisitRate);
  }
  if (!stores.size) throw new Error('漏斗表中未找到四城可展示的门店。');
  return Array.from(stores.values(), ({channels,revisitRates,...row}) => {
    const match = detail.get(organizationKey(row));
    const result = {...row, matched:Boolean(match), revisitConflict:revisitRates.size>1,
      revisitRate:revisitRates.size === 1 ? [...revisitRates][0] : null};
    for (const key of ['responseAverage','callRate','followAverage']) {
      result[key] = parseNumber(match?.[key]);
    }
    return result;
  });
}
