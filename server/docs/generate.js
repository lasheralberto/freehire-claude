import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './config.js';
import { offerDir } from './paths.js';
import { readCvBase } from './cv-base.js';
import { validateCv, validateLetter } from './schema.js';
import { checkCvFacts } from './fact-check.js';
import { renderCvPdf, renderLetterPdf } from './render.js';
import { buildCvPrompt, buildLetterPrompt } from './prompts.js';
import { parseJsonObject } from '../../mcp/src/sampling.js';

const TIMEOUT_MS = 300_000;
const RETRY_SUFFIX = '\n\nTu respuesta anterior no era JSON válido. Devuelve SOLO el objeto JSON.';

export async function generateDocument({
  kind, slug, notes = '', config, getJob, runClaude, today = new Date().toISOString().slice(0, 10),
}) {
  const dataDir = config?.dataDir;
  if (!dataDir) throw new HttpError(409, 'Configura la carpeta de datos en Ajustes');
  const cvBase = await readCvBase(dataDir);
  if (cvBase === null) throw new HttpError(409, 'Sube tu CV base en Ajustes');
  const job = await getJob(slug);

  const isCv = kind === 'cv';
  const { systemPrompt, prompt } = isCv
    ? buildCvPrompt({ cvBase, job })
    : buildLetterPrompt({ cvBase, job, notes, today });
  const validate = isCv ? validateCv : validateLetter;

  let doc;
  let model;
  for (let attempt = 0; attempt < 2 && !doc; attempt++) {
    const res = await runClaude({
      prompt: attempt ? prompt + RETRY_SUFFIX : prompt,
      systemPrompt, model: config.docModel, timeoutMs: TIMEOUT_MS,
    });
    model = res.model;
    try {
      doc = validate(parseJsonObject(res.text));
    } catch { /* retry once */ }
  }
  if (!doc) throw new HttpError(502, 'El modelo no devolvió un documento válido');

  const warnings = isCv ? checkCvFacts(doc, cvBase) : [];
  const buf = await (isCv ? renderCvPdf(doc) : renderLetterPdf(doc));
  const dir = offerDir(dataDir, slug);
  await mkdir(dir, { recursive: true });
  const file = isCv ? 'cv.pdf' : 'cover-letter.pdf';
  const out = path.join(dir, file);
  await writeFile(out, buf);
  return { path: out, file, warnings, model };
}
