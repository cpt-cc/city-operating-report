// Public write access is intentional: every visitor can import reports.
const API = 'https://api.github.com/repos/cpt-cc/city-operating-report';
const PREFIX = 'archives/';
const DIAGNOSES = PREFIX + 'diagnoses.json';
const LIMIT = 900 * 1024; // GitHub Contents API returns inline content only up to 1 MB.
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (!dateRe.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === s;
}
function fileFor(key) {
  const weekly = key.startsWith('week:');
  const date = weekly ? key.slice(5) : key;
  if (!validDate(date) || (weekly && new Date(date+'T00:00:00Z').getUTCDay() !== 1)) return null;
  return PREFIX + (weekly ? 'week-' : 'day-') + date + '.json';
}
function decode64(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g,'')), ch => ch.charCodeAt(0));
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function encode64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i=0; i<bytes.length; i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
async function github(env, path, options = {}) {
  return fetch(API + path, {...options, headers:{
    Accept:'application/vnd.github+json', Authorization:'Bearer ' + env.GITHUB_TOKEN,
    'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'city-operating-report',
    ...(options.body ? {'Content-Type':'application/json'} : {})
  }});
}
function response(body, status, origin) {
  return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'Access-Control-Allow-Origin':origin, Vary:'Origin'}});
}
function passwordMatches(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || expected.length < 16 || candidate.length > 256) return false;
  const a = new TextEncoder().encode(candidate), b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i=0; i<Math.max(a.length,b.length); i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}
function validDiagnosis(item) {
  return item && typeof item.scope === 'string' && item.scope.length <= 1000 &&
    typeof item.key === 'string' && item.key.length <= 500 && item.edit &&
    ['title','observation','action'].every(k => typeof item.edit[k] === 'string' && item.edit[k].trim().length > 0 && item.edit[k].length <= (k === 'title' ? 100 : 1000));
}
function validEdits(data) {
  return Array.isArray(data) && data.every(row => Array.isArray(row) && row.length === 3 && validDiagnosis({scope:row[0],key:row[1],edit:row[2]}));
}
async function readFile(env, path) {
  const res = await github(env,'/contents/' + path + '?ref=main');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('归档读取失败');
  const file = await res.json();
  return {sha:file.sha, data:JSON.parse(decode64(file.content))};
}
async function putFile(env, path, data, sha, message) {
  const text = JSON.stringify(data);
  if (new TextEncoder().encode(text).length > LIMIT) return {status:413};
  return github(env,'/contents/' + path,{method:'PUT',body:JSON.stringify({message,content:encode64(text),branch:'main',...(sha ? {sha} : {})})});
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin !== 'https://cpt-cc.github.io') return new Response('Forbidden', {status:403});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',Vary:'Origin'}});
    const route = new URL(request.url).pathname;
    if (!['/archive','/diagnoses','/delete-report'].includes(route)) return response({error:'不存在的地址。'},404,origin);
    if (!env.GITHUB_TOKEN) return response({error:'共享服务尚未配置。'},503,origin);
    try {
      if (request.method === 'GET' && route === '/archive') {
        const listing = await github(env,'/contents/' + PREFIX + '?ref=main');
        if (listing.status === 404) return response({reports:[],edits:[]},200,origin);
        if (!listing.ok) return response({error:'无法读取 GitHub 归档。'},502,origin);
        const files = await listing.json();
        if (!Array.isArray(files) || files.length >= 1000) return response({error:'归档数量超过读取限制。'},503,origin);
        const reports = await Promise.all(files.filter(x=>x.type==='file' && /^(week|day)-\d{4}-\d{2}-\d{2}\.json$/.test(x.name)).map(async file=>{
          const res = await github(env,'/contents/' + PREFIX + file.name + '?ref=main');
          if (!res.ok) throw new Error('归档读取失败');
          const item = await res.json();
          const report = JSON.parse(decode64(item.content));
          if (!report || fileFor(report.date) !== PREFIX + file.name || !(report.deleted === true || Array.isArray(report.entry?.rows))) throw new Error('归档格式有误');
          return [report.date,report.deleted === true ? {deleted:true} : report.entry];
        }));
        const editsFile = files.some(f=>f.type==='file' && f.name==='diagnoses.json') ? await readFile(env, DIAGNOSES) : null;
        if (editsFile && !validEdits(editsFile.data)) throw new Error('诊断归档格式有误');
        return response({reports,edits:editsFile?.data || []},200,origin);
      }
      if (request.method !== 'POST') return response({error:'不支持的操作。'},405,origin);
      if (Number(request.headers.get('Content-Length') || 0) > LIMIT) return response({error:'报表过大。'},413,origin);
      const text = await request.text();
      if (new TextEncoder().encode(text).length > LIMIT) return response({error:'报表过大。'},413,origin);
      const payload = JSON.parse(text);
      if (route === '/diagnoses') {
        if (!validDiagnosis(payload)) return response({error:'诊断内容格式有误。'},400,origin);
        const existing = await readFile(env,DIAGNOSES);
        const edits = existing?.data || [];
        if (!validEdits(edits)) throw new Error('诊断归档格式有误');
        const next = edits.filter(row=>row[0] !== payload.scope || row[1] !== payload.key);
        next.push([payload.scope,payload.key,{title:payload.edit.title.trim(),observation:payload.edit.observation.trim(),action:payload.edit.action.trim()}]);
        const result = await putFile(env,DIAGNOSES,next,existing?.sha,'Update report diagnosis');
        if ([409,422].includes(result.status)) return response({error:'其他人刚刚更新，请刷新后重试。'},409,origin);
        if (!result.ok) return response({error:'诊断保存失败。'},result.status === 413 ? 413 : 502,origin);
        return response({saved:true},200,origin);
      }
      if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16) return response({error:'管理员密码尚未配置，请联系维护人。'},503,origin);
      if (!passwordMatches(payload.password,env.ADMIN_PASSWORD)) return response({error:'管理员密码不正确。'},403,origin);
      if (route === '/delete-report') {
        if (typeof payload.date !== 'string' || !fileFor(payload.date)) return response({error:'报表日期无效。'},400,origin);
        const path = fileFor(payload.date);
        const existing = await readFile(env,path);
        const result = await putFile(env,path,{date:payload.date,deleted:true},existing?.sha,'Remove report '+payload.date);
        if ([409,422].includes(result.status)) return response({error:'归档已被其他人更新，请刷新后重试。'},409,origin);
        if (!result.ok) return response({error:'删除失败，请重试。'},502,origin);
        return response({deleted:true},200,origin);
      }
      const {date,entry} = payload;
      if (typeof date !== 'string' || !fileFor(date) || !entry || !Array.isArray(entry.rows) || entry.rows.length > 5000 ||
          !validDate(entry.detailDate) || !validDate(entry.end) ||
          (date.startsWith('week:') ? (entry.period !== 'week' || Date.parse(entry.end)-Date.parse(date.slice(5)) !== 6*86400000) :
            (entry.end !== date || !['day','unknown'].includes(entry.period))))
        return response({error:'报表日期或格式无效。'},400,origin);
      const path = fileFor(date);
      const existing = await readFile(env,path);
      const result = await putFile(env,path,{date,entry},existing?.sha,'Update report ' + date);
      if (result.status === 409 || result.status === 422) return response({error:'归档已被其他人更新，请刷新后重试。'},409,origin);
      if (!result.ok) return response({error:'GitHub 保存失败。'},502,origin);
      return response({saved:true},200,origin);
    } catch (_) { return response({error:'共享归档暂时不可用，请重试。'},502,origin); }
  }
};
