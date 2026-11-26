'use strict';

async function archiveApi(path, payload) {
  if (path !== 'archive') throw new Error('该操作不可用。');
  if (payload) {
    if (!SHARED_API_BASE) throw new Error('共享导入服务尚未配置，请联系网站维护人。');
    const saved = await fetch(SHARED_API_BASE + '/archive', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), cache:'no-store'
    });
    const result = await saved.json().catch(()=>({}));
    if (!saved.ok) throw new Error(result.error || '共享数据保存失败，请重试。');
    return result;
  }
  const response = await fetch('./manifest.json', {cache:'no-store'});
  if (!response.ok) throw new Error('无法读取数据清单。');
  const manifest = await response.json();
  const reports = await Promise.all(manifest.map(async item => {
    if (item.kind !== 'weekly' || !/^\d{4}-\d{2}-\d{2}$/.test(item.start) ||
        shift(item.start,6) !== item.end || new Date(item.start+'T00:00:00Z').getUTCDay() !== 1)
      throw new Error('周报日期必须是同一周的周一至周日。');
    const files = await Promise.all([item.sales,item.detail].map(async name => {
      if (!/^[a-zA-Z0-9._-]+\.xlsx$/.test(name)) throw new Error('底表路径无效。');
      const fileResponse = await fetch('./' + name, {cache:'no-store'});
      if (!fileResponse.ok) throw new Error('无法读取底表：' + name);
      return fileResponse.blob();
    }));
    const sales = await readXlsx(files[0],salesColumns,'销售转化漏斗分析表');
    const detail = await readXlsx(files[1],detailColumns,'数据详情');
    return ['week:' + item.start,{rows:assembleReport(sales,detail),detailDate:item.end,period:'week',end:item.end}];
  }));
  if (new Set(reports.map(item => item[0])).size !== reports.length) throw new Error('数据清单中有重复周报。');
  if (!SHARED_API_BASE) return {reports, edits:[]};
  const remoteResponse = await fetch(SHARED_API_BASE + '/archive', {cache:'no-store'});
  if (!remoteResponse.ok) throw new Error('无法读取共享归档。');
  const remote = await remoteResponse.json();
  const merged = new Map(reports);
  for (const [key,entry] of remote.reports) merged.set(key,entry);
  return {reports:[...merged], edits:[]};
}
