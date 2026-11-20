'use strict';

async function exportReportImage() {
  const sections = $('report-sections');
  if (!sections) return;
  const button = $('download');
  const buttonText = button.querySelector('span');
  const title = $('title').textContent;
  const context = $('subtitle').textContent;
  const report = sections.cloneNode(true);
  report.removeAttribute('id');
  report.classList.add('image-report');
  report.querySelectorAll('[data-export-control], details').forEach(element => element.remove());
  const metadata = document.createElement('p');
  metadata.className = 'image-context';
  metadata.textContent = title + '　·　' + context;
  report.querySelector('.panel-header > div').prepend(metadata);

  button.disabled = true;
  buttonText.textContent = '正在生成';
  try {
    await document.fonts.ready;
    const blob = await renderReportImage(report);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = context.match(/\d{4}-\d{2}-\d{2}(?: 至 \d{4}-\d{2}-\d{2})?/)?.[0];
    link.download = title + (date ? '_' + date.replace(' 至 ','_') : '') + '.png';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    console.error('Report image export failed', error);
    notify('图片生成失败，请重试或缩小筛选范围。');
  } finally {
    buttonText.textContent = '导出图片';
    button.disabled = false;
  }
}

async function renderReportImage(report) {
  const sheet = $('app-styles').sheet;
  const css = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
  const staging = document.createElement('div');
  staging.className = 'image-staging';
  staging.setAttribute('aria-hidden','true');
  staging.append(report);
  document.body.append(staging);
  if (report.scrollWidth > report.clientWidth) {
    report.style.width = (report.scrollWidth + 16) + 'px';
  }
  const rect = report.getBoundingClientRect();
  staging.remove();

  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const ratio = Math.min(2, 14000 / height, 14000 / width, Math.sqrt(14500000 / (width * height)));
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('width',width);
  svg.setAttribute('height',height);
  const foreign = document.createElementNS(svgNS,'foreignObject');
  foreign.setAttribute('width','100%');
  foreign.setAttribute('height','100%');
  const style = document.createElement('style');
  style.textContent = css;
  report.prepend(style);
  foreign.append(report);
  svg.append(foreign);

  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
  });
}
