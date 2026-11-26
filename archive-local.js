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

async function archiveApi(path, payload) {
  if (path !== 'archive') throw new Error('该操作不可用。');
  if (payload) {
    if (!SHARED_API_BASE) throw new Error('共享导入服务尚未配置，请联系网站维护人。');
    return fetchJson(SHARED_API_BASE + '/archive', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), cache:'no-store'
    }, 30000, '保存超时，结果尚未确认；请刷新历史归档核对后再重试。');
  }
  const requests = [fetchJson('./history.json', {cache:'no-cache'}, 15000, '历史数据读取超时，请检查网络后重试。')];
  if (SHARED_API_BASE) requests.push(fetchJson(SHARED_API_BASE + '/archive', {cache:'no-store'}, 15000,
    '共享归档连接超时，请检查网络后重试。'));
  const [history, remote = {reports:[]}] = await Promise.all(requests);
  if (!Array.isArray(history.reports) || !Array.isArray(remote.reports)) throw new Error('报表数据格式有误。');
  const merged = new Map(history.reports);
  for (const [key,entry] of remote.reports) merged.set(key,entry);
  return {reports:[...merged], edits:[]};
}
