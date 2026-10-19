import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractText } from 'unpdf';
import { HttpError } from './config.js';
import { CV_BASE_DIR } from './paths.js';

const MIN_CHARS = 50;

export async function extractPdfText(buffer) {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });
  return text.join('\n\n').trim();
}

export async function saveCvBase(dataDir, buffer, { extract = extractPdfText } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'El archivo no es un PDF');
  }
  const text = (await extract(buffer)) ?? '';
  if (text.length < MIN_CHARS) {
    throw new HttpError(422, 'No se pudo extraer texto del PDF (¿es un escaneo?)');
  }
  const dir = path.join(dataDir, CV_BASE_DIR);
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, 'cv-base.pdf');
  const mdPath = path.join(dir, 'cv-base.md');
  await writeFile(pdfPath, buffer);
  await writeFile(mdPath, text);
  return { pdfPath, mdPath, chars: text.length };
}

export async function readCvBase(dataDir) {
  try {
    const text = await readFile(path.join(dataDir, CV_BASE_DIR, 'cv-base.md'), 'utf8');
    return text.trim() ? text : null;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
