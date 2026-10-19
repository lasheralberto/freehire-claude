async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const health = () => getJson('/api/health');
export const getJob = (slug) => getJson(`/api/jobs/${encodeURIComponent(slug)}`);
export const similarJobs = (slug) => getJson(`/api/jobs/${encodeURIComponent(slug)}/similar`);

export function searchJobs(params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  return getJson(`/api/search?${qs}`);
}

/**
 * POSTs to the bridge and parses its Server-Sent Events stream.
 * @param {{query: string, limit: number, model: string}} body
 * @param {{onEvent: (event: string, data: any) => void, signal: AbortSignal}} opts
 */
export async function agenticSearch(body, { onEvent, signal }) {
  const res = await fetch('/api/agentic-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}

async function sendJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const getConfig = () => getJson('/api/config');
export const saveConfig = (patch) => sendJson('/api/config', 'PUT', patch);
export const generateDoc = (slug, kind, notes) =>
  sendJson(`/api/jobs/${encodeURIComponent(slug)}/${kind}`, 'POST', notes ? { notes } : {});

export async function uploadCvBase(file) {
  const res = await fetch('/api/cv-base', {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
