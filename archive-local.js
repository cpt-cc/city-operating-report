'use strict';

async function fetchJson(url, options, timeoutMs, timeoutMessage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...options, signal:controller.signal});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '无法读取共享归档，请重试。');
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally { clearTimeout(timer); }
}

async function readGithubArchive() {
  const base = 'https://api.github.com/repos/cpt-cc/city-operating-report/contents/archives';
  const files = await fetchJson(base + '?ref=main', {cache:'no-store'}, 10000, 'GitHub 归档列表读取超时。');
  if (!Array.isArray(files) || files.length >= 1000) throw new Error('GitHub 归档列表不完整。');
  async function readContent(name) {
    const file = await fetchJson(base + '/' + name + '?ref=main', {cache:'no-store'}, 10000, 'GitHub 归档读取超时。');
    if (typeof file.content !== 'string' || file.encoding !== 'base64') throw new Error('GitHub 归档格式有误。');
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g,'')), ch => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }
  const names = files.filter(file => file.type === 'file' && /^(week|day)-\d{4}-\d{2}-\d{2}\.json$/.test(file.name)).map(file => file.name);
  const reports = await Promise.all(names.map(async name => {
    const record = await readContent(name);
    const expected = name.startsWith('week-') ? 'week:' + name.slice(5,-5) : name.slice(4,-5);
    if (record.date !== expected || !(record.deleted === true || Array.isArray(record.entry?.rows))) throw new Error('GitHub 归档格式有误。');
    return [record.date, record.deleted === true ? {deleted:true} : record.entry];
  }));
  const edits = files.some(file=>file.type==='file' && file.name==='diagnoses.json') ? await readContent('diagnoses.json') : [];
  if (!Array.isArray(edits) || !edits.every(row => Array.isArray(row) && row.length === 3)) throw new Error('诊断归档格式有误。');
  return {reports,edits};
}

async function archiveApi(path, payload) {
  if (payload) {
    if (!SHARED_API_BASE) throw new Error('共享导入服务尚未配置，请联系网站维护人。');
    if (!['archive','diagnoses','delete-report'].includes(path)) throw new Error('该操作不可用。');
    return fetchJson(SHARED_API_BASE + '/' + path, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), cache:'no-store'
    }, 30000, '保存超时，结果尚未确认；请刷新历史归档核对后再重试。');
  }
  if (path !== 'archive') throw new Error('该操作不可用。');
  const historyPromise = fetchJson('./history.json', {cache:'no-cache'}, 15000, '历史数据读取超时，请检查网络后重试。');
  const remotePromise = SHARED_API_BASE ? Promise.any([
    fetchJson(SHARED_API_BASE + '/archive', {cache:'no-store'}, 10000, '共享归档连接超时。').then(data => {
      if (!Array.isArray(data.reports)) throw new Error('共享归档格式有误。');
      return {reports:data.reports, edits:Array.isArray(data.edits) ? data.edits : [], warning:''};
    }),
    readGithubArchive().then(data => ({...data, warning:'当前通过 GitHub 读取共享数据；导入仍需要连接共享服务，如保存失败请检查网络。'}))
  ]).catch(() => ({reports:[], warning:'共享归档暂时无法连接，当前只显示历史快照，可能不是最新数据；导入可能不可用。请检查网络后重试。'})) : Promise.resolve({reports:[], warning:'共享服务未配置，当前只显示历史快照，可能不是最新数据。'});
  const [history, remote] = await Promise.all([historyPromise, remotePromise]);
  if (!Array.isArray(history.reports)) throw new Error('历史数据格式有误。');
  const merged = new Map(history.reports);
  for (const [key,entry] of remote.reports) {
    if (entry?.deleted === true) merged.delete(key); else merged.set(key,entry);
  }
  return {reports:[...merged], edits:remote.edits || [], warning:remote.warning};
}
