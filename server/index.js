// Local bridge between the React panel and the freehire MCP server.
//
// Browser ──HTTP/SSE──▶ this bridge ──MCP stdio──▶ freehire MCP server
//                           ▲                            │
//                           └── sampling/createMessage ◀─┘
//                           │
//                           └──▶ `claude -p` (your local Claude Code login — no API key)
//
// The bridge is the MCP *client*: it advertises the `sampling` capability and fulfils each
// sampling request by running the local Claude Code CLI.

import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema, LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { runClaude, pickModel, samplingMessagesToPrompt, resolveClaudeBin } from '../mcp/src/claude-cli.js';
import { HttpError, MODELS, loadConfig, saveConfig } from './docs/config.js';
import { CV_BASE_DIR, offerDir } from './docs/paths.js';
import { saveCvBase, readCvBase } from './docs/cv-base.js';
import { generateDocument } from './docs/generate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_ENTRY = join(ROOT, 'mcp', 'src', 'index.js');
const WEB_DIST = join(ROOT, 'web', 'dist');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
// Each search spends the user's Claude Code quota, so only our own UI may call the bridge.
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);

async function connectMcp({ onSampling, onStep } = {}) {
  const sampling = Boolean(onSampling);
  const client = new Client({ name: 'freehire-web-bridge', version: '0.1.0' }, { capabilities: sampling ? { sampling: {} } : {} });

  if (sampling) {
    client.setRequestHandler(CreateMessageRequestSchema, async (req, extra) => {
      const { messages, systemPrompt, modelPreferences } = req.params;
      const model = pickModel(modelPreferences);
      onSampling({ phase: 'start', model });
      const res = await runClaude({ prompt: samplingMessagesToPrompt(messages), systemPrompt, model, signal: extra.signal });
      onSampling({ phase: 'done', model: res.model, durationMs: res.durationMs, costUsd: res.costUsd });
      return { role: 'assistant', content: { type: 'text', text: res.text }, model: res.model, stopReason: 'endTurn' };
    });
  }
  if (onStep) {
    client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      if (n.params.logger === 'agentic_search') onStep(n.params.data);
    });
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_ENTRY],
    // Sampling must go through us; never let the server silently shell out on its own.
    env: { ...process.env, FREEHIRE_SAMPLING_FALLBACK: sampling ? 'off' : process.env.FREEHIRE_SAMPLING_FALLBACK ?? '' },
    stderr: 'inherit',
  });
  await client.connect(transport);
  return client;
}

// One long-lived client for plain (non-LLM) tool calls.
let sharedClient;
async function shared() {
  if (!sharedClient) {
    sharedClient = connectMcp().catch((err) => {
      sharedClient = undefined;
      throw err;
    });
    (await sharedClient).onclose = () => (sharedClient = undefined);
  }
  return sharedClient;
}

async function callJsonTool(name, args) {
  const client = await shared();
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  if (res.isError) throw Object.assign(new Error(text), { status: 502 });
  return JSON.parse(text);
}

const NON_FILTER_PARAMS = new Set(['q', 'q_fields', 'sort', 'order', 'limit', 'offset']);

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'origin not allowed' });
  next();
});

app.get('/api/health', async (_req, res) => {
  let claude = null;
  try {
    claude = resolveClaudeBin();
  } catch (err) {
    claude = `error: ${err.message}`;
  }
  try {
    const { tools } = await (await shared()).listTools();
    res.json({ ok: true, claude, tools: tools.map((t) => t.name) });
  } catch (err) {
    res.status(500).json({ ok: false, claude, error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const { q, q_fields, sort, order, limit, offset } = req.query;
  const filters = Object.fromEntries(Object.entries(req.query).filter(([k, v]) => !NON_FILTER_PARAMS.has(k) && v !== ''));
  try {
    res.json(
      await callJsonTool('search_jobs', {
        ...(q ? { q } : {}),
        ...(q_fields ? { q_fields } : {}),
        ...(sort ? { sort } : {}),
        ...(order ? { order } : {}),
        limit: Number(limit) || 20,
        offset: Number(offset) || 0,
        filters,
      }),
    );
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/facets', async (req, res) => {
  const { q, ...filters } = req.query;
  try {
    res.json(await callJsonTool('job_facets', { ...(q ? { q } : {}), filters }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/jobs/:slug', async (req, res) => {
  try {
    res.json(await callJsonTool('get_job', { slug: req.params.slug }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/jobs/:slug/similar', async (req, res) => {
  try {
    res.json(await callJsonTool('similar_jobs', { slug: req.params.slug, limit: 6 }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// --- CV / cover-letter documents ---
const CONFIG_FILE = process.env.FREEHIRE_CONFIG || join(ROOT, 'config.json');
const DOC_FILES = new Set(['cv.pdf', 'cover-letter.pdf']);

const errStatus = (err) => (err instanceof HttpError ? err.status : Number.isInteger(err?.status) ? err.status : 500);
const sendError = (res, err) => res.status(errStatus(err)).json({ error: err.message });
const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    sendError(res, err);
  }
};

async function configView() {
  const config = await loadConfig(CONFIG_FILE);
  const mdPath = config.dataDir ? join(config.dataDir, CV_BASE_DIR, 'cv-base.md') : null;
  const hasCvBase = Boolean(mdPath) && (await readCvBase(config.dataDir)) !== null;
  return { dataDir: config.dataDir, docModel: config.docModel, models: MODELS, hasCvBase, cvBaseMdPath: hasCvBase ? mdPath : null };
}

app.get('/api/config', route(configView));

app.put('/api/config', route(async (req) => {
  const { dataDir, docModel } = req.body || {};
  await saveConfig(CONFIG_FILE, { ...(dataDir !== undefined ? { dataDir } : {}), ...(docModel !== undefined ? { docModel } : {}) });
  return configView();
}));

app.post('/api/cv-base', express.raw({ type: 'application/pdf', limit: '10mb' }), route(async (req) => {
  const { dataDir } = await loadConfig(CONFIG_FILE);
  if (!dataDir) throw new HttpError(409, 'Configura la carpeta de datos en Ajustes');
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Se esperaba un PDF (application/pdf)');
  const { mdPath, chars } = await saveCvBase(dataDir, req.body);
  return { mdPath, chars };
}));

for (const [kind, file] of [['cv', 'cv.pdf'], ['cover-letter', 'cover-letter.pdf']]) {
  app.post(`/api/jobs/:slug/${kind}`, route(async (req) => {
    const { slug } = req.params;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    const config = await loadConfig(CONFIG_FILE);
    const out = await generateDocument({
      kind,
      slug,
      notes,
      config,
      getJob: (s) => callJsonTool('get_job', { slug: s, max_description_chars: 50000 }),
      runClaude,
    });
    return { ...out, url: `/api/files/${encodeURIComponent(slug)}/${out.file}` };
  }));
}

app.get('/api/files/:slug/:file', async (req, res) => {
  try {
    const { slug, file } = req.params;
    const { dataDir } = await loadConfig(CONFIG_FILE);
    if (!DOC_FILES.has(file) || !dataDir) return res.status(404).json({ error: 'not found' });
    const dir = offerDir(dataDir, slug);
    if (!existsSync(join(dir, file))) return res.status(404).json({ error: 'not found' });
    res.sendFile(file, { root: dir, dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) sendError(res, err);
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Errors thrown by body parsers (e.g. payload too large -> 413).
app.use('/api', (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  sendError(res, err);
});

// Agentic search, streamed as Server-Sent Events: step / sampling / result / error.
app.post('/api/agentic-search', async (req, res) => {
  const { query, limit = 10, model = 'haiku' } = req.body || {};
  if (typeof query !== 'string' || query.trim().length < 3) return res.status(400).json({ error: 'query is required' });

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  // A dedicated MCP session per search keeps its sampling/progress events unambiguous.
  let client;
  try {
    client = await connectMcp({ onSampling: (s) => send('sampling', s), onStep: (s) => send('step', s) });
    const result = await client.callTool(
      { name: 'agentic_search', arguments: { query: query.trim(), limit: Number(limit) || 10, model } },
      undefined,
      { signal: abort.signal, timeout: 600_000 },
    );
    if (result.isError) send('error', { message: result.content?.[0]?.text || 'agentic search failed' });
    else send('result', result.structuredContent);
  } catch (err) {
    if (!abort.signal.aborted) send('error', { message: err.message });
  } finally {
    clearInterval(heartbeat);
    await client?.close().catch(() => {});
    res.end();
  }
});

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`[bridge] http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}  (MCP: ${MCP_ENTRY})`);
});
