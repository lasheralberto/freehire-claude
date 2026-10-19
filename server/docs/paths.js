import path from 'node:path';
import { HttpError } from './config.js';

export const CV_BASE_DIR = '_cv-base';

// slug -> carpeta de la oferta, siempre dentro de dataDir
export function offerDir(dataDir, slug) {
  const safe = String(slug).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new HttpError(400, 'Identificador de oferta no válido');
  const root = path.resolve(dataDir);
  const dir = path.resolve(root, safe);
  if (!dir.startsWith(root + path.sep)) throw new HttpError(400, 'Ruta fuera de la carpeta de datos');
  return dir;
}
