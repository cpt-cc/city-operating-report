'use strict';

let reportDbPromise;
function openReportDb() {
  reportDbPromise ??= new Promise((resolve,reject) => {
    const name = 'city-operating-report:' + location.pathname.replace(/index\.html$/,'');
    const request = indexedDB.open(name,1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('reports',{keyPath:'date'});
      request.result.createObjectStore('diagnoses',{keyPath:['scope','key']});
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); reportDbPromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他报表页面后重试。'));
  }).catch(error => {
    reportDbPromise = undefined;
    throw error;
  });
  return reportDbPromise;
}
function awaitTransaction(transaction) {
  return new Promise((resolve,reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('当前浏览器无法保存归档。'));
  });
}
async function archiveApi(path, payload) {
  const db = await openReportDb();
  if (!payload && path === 'archive') {
    const transaction = db.transaction(['reports','diagnoses'],'readonly');
    const finished = awaitTransaction(transaction);
    const reports = transaction.objectStore('reports').getAll();
    const edits = transaction.objectStore('diagnoses').getAll();
    await finished;
    return {
      reports:reports.result.map(row=>[row.date,row.entry]),
      edits:edits.result.map(row=>[row.scope,row.key,row.edit]),
    };
  }
  const store = path === 'archive' ? 'reports' : path;
  if (!['reports','diagnoses'].includes(store) || !payload) throw new Error('归档操作有误。');
  if (store === 'diagnoses' && !['title','observation','action'].every(field=>payload.edit?.[field]?.trim())) {
    throw new Error('请填写异常标题、诊断说明和改善动作。');
  }
  const transaction = db.transaction(store,'readwrite');
  const finished = awaitTransaction(transaction);
  transaction.objectStore(store).put(payload);
  await finished;
  return {saved:true};
}
