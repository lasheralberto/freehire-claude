import { readFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MODELS = ['haiku', 'sonnet', 'opus'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DEFAULTS = { dataDir: null, docModel: 'sonnet' };

export function loadConfig(file) {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfig(file, patch = {}) {
  const cfg = loadConfig(file);
  if (patch.dataDir !== undefined) {
    if (typeof patch.dataDir !== 'string' || !path.isAbsolute(patch.dataDir)) {
      throw new HttpError(400, 'La carpeta debe ser una ruta absoluta');
    }
    const st = await stat(patch.dataDir).catch(() => null);
    if (st && !st.isDirectory()) throw new HttpError(400, 'La ruta no es una carpeta');
    await mkdir(patch.dataDir, { recursive: true });
    cfg.dataDir = patch.dataDir;
  }
  if (patch.docModel !== undefined) {
    if (!MODELS.includes(patch.docModel)) throw new HttpError(400, 'Modelo no válido');
    cfg.docModel = patch.docModel;
  }
  await writeFile(file, JSON.stringify(cfg, null, 2));
  return cfg;
}
