import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { canvasAt, canvasBlob, zipBlobs } from './media.js';

export async function mergePdf(files) {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer());
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return new Blob([await merged.save()], { type: 'application/pdf' });
}

function pageGroups(specification, total) {
  if (!specification.trim()) return Array.from({ length: total }, (_, index) => [index]);
  return specification.split(/[,，]/u).map((part) => {
    const parsed = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/u);
    if (!parsed) throw new Error('请输入页码或范围，例如 1-3,5,7-8。');
    const first = Number(parsed[1]);
    const last = Number(parsed[2] ?? parsed[1]);
    if (first < 1 || last < first || last > total) throw new Error(`页码范围必须位于 1–${total}。`);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index - 1);
  });
}

export async function splitPdf(file, specification) {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(await file.arrayBuffer());
  const groups = pageGroups(specification, source.getPageCount());
  const exports = [];
  for (const [index, group] of groups.entries()) {
    const document = await PDFDocument.create();
    const pages = await document.copyPages(source, group);
    pages.forEach((page) => document.addPage(page));
    exports.push([`part-${index + 1}.pdf`, new Blob([await document.save()], { type: 'application/pdf' })]);
  }
  return zipBlobs(exports);
}

export async function organizePdf(file, specification, rotation, reverse) {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const source = await PDFDocument.load(await file.arrayBuffer());
  const output = await PDFDocument.create();
  const indexes = pageGroups(specification, source.getPageCount()).flat();
  const pages = await output.copyPages(source, reverse ? indexes.reverse() : indexes);
  for (const page of pages) {
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
    output.addPage(page);
  }
  return new Blob([await output.save()], { type: 'application/pdf' });
}

export async function renderPdf(file, specification, scale, format = 'png') {
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = workerUrl;
  const pdfRoot = new URL('/pdf/', location.href);
  const job = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: new URL('cmaps/', pdfRoot).href,
    standardFontDataUrl: new URL('standard_fonts/', pdfRoot).href,
    wasmUrl: new URL('wasm/', pdfRoot).href,
    iccUrl: new URL('iccs/', pdfRoot).href,
    isEvalSupported: false,
  });
  try {
    const pdf = await job.promise;
    const pages = [...new Set(pageGroups(specification, pdf.numPages).flat())];
    const exports = [];
    for (const pageNumber of pages) {
      const page = await pdf.getPage(pageNumber + 1);
      const viewport = page.getViewport({ scale });
      const canvas = canvasAt(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, viewport }).promise;
      exports.push([`page-${String(pageNumber + 1).padStart(3, '0')}.${format}`,
        await canvasBlob(canvas, format === 'jpg' ? 'image/jpeg' : 'image/png', .9)]);
      page.cleanup();
    }
    return exports.length === 1 ? { blob: exports[0][1], name: exports[0][0] }
      : { blob: await zipBlobs(exports), name: 'PDF-图片.zip' };
  } finally {
    await job.destroy();
  }
}
