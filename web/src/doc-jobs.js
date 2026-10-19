import { useSyncExternalStore } from 'react';

// Estado de generación de documentos a nivel de módulo: sobrevive al desmontaje del drawer.
const IDLE = { status: 'idle' };
const store = new Map(); // "slug:kind" -> { status, result?, error? }
const listeners = new Set();

const key = (slug, kind) => `${slug}:${kind}`;
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function put(k, v) {
  store.set(k, v);
  listeners.forEach((fn) => fn());
}

export const getDocState = (slug, kind) => store.get(key(slug, kind)) ?? IDLE;

export function useDocState(slug, kind) {
  return useSyncExternalStore(subscribe, () => getDocState(slug, kind));
}

// Lanza `fn` para slug:kind salvo que ya haya una petición en curso.
export async function runDoc(slug, kind, fn) {
  const k = key(slug, kind);
  if (store.get(k)?.status === 'busy') return;
  put(k, { status: 'busy' });
  try {
    put(k, { status: 'done', result: await fn() });
  } catch (e) {
    put(k, { status: 'error', error: e.message });
  }
}
