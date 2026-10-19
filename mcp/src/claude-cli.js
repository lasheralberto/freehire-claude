// Runs one completion on the locally installed Claude Code CLI (`claude -p`), using the user's
// existing Claude Code login. This is what lets sampling work without any API key.

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_MODEL = process.env.FREEHIRE_CLAUDE_MODEL || 'haiku';
const TIMEOUT_MS = Number(process.env.FREEHIRE_CLAUDE_TIMEOUT_MS || 120_000);

let cachedBin;

// On Windows `claude` is an npm .cmd shim; spawning it would need a shell (and shell quoting of
// the prompt). Resolve the real executable behind the shim instead.
export function resolveClaudeBin() {
  if (cachedBin) return cachedBin;
  if (process.env.CLAUDE_BIN) return (cachedBin = process.env.CLAUDE_BIN);
  if (process.platform !== 'win32') return (cachedBin = 'claude');
  let candidates = [];
  try {
    candidates = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch {
    throw new Error('Claude Code CLI not found on PATH. Install it or set CLAUDE_BIN.');
  }
  for (const c of candidates) {
    if (/\.exe$/i.test(c)) return (cachedBin = c);
    if (/\.cmd$/i.test(c)) {
      const m = readFileSync(c, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/i);
      const exe = m && resolve(dirname(c), m[1]);
      if (exe && existsSync(exe)) return (cachedBin = exe);
    }
  }
  throw new Error(`Could not resolve a claude executable from: ${candidates.join(', ')}. Set CLAUDE_BIN.`);
}

const MODEL_ALIASES = ['haiku', 'sonnet', 'opus'];

// MCP modelPreferences.hints are substrings ("claude-3-haiku", "sonnet"...). Map them to a CLI alias.
export function pickModel(modelPreferences) {
  for (const hint of modelPreferences?.hints || []) {
    const alias = MODEL_ALIASES.find((a) => hint?.name?.toLowerCase().includes(a));
    if (alias) return alias;
  }
  return DEFAULT_MODEL;
}

/**
 * @param {{ prompt: string, systemPrompt?: string, model?: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ text: string, model: string, durationMs: number, costUsd?: number }>}
 */
export function runClaude({ prompt, systemPrompt, model = DEFAULT_MODEL, signal }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--tools', '',            // pure completion: no file/shell/web tools
    '--strict-mcp-config',    // and no MCP servers (avoids recursion into this very server)
    '--safe-mode',            // no hooks, plugins, CLAUDE.md or skills from the user's setup
    '--no-session-persistence',
  ];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);

  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(resolveClaudeBin(), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Extended thinking roughly doubles latency on these short JSON tasks for no gain.
      env: { ...process.env, MAX_THINKING_TOKENS: process.env.FREEHIRE_CLAUDE_THINKING_TOKENS || '0' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('claude call aborted'));
      let out;
      try {
        out = JSON.parse(stdout);
      } catch {
        return reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
      }
      if (out.is_error) return reject(new Error(`claude error: ${out.result || out.subtype}`));
      const usedModel = Object.keys(out.modelUsage || {})[0] || model;
      resolvePromise({ text: out.result ?? '', model: usedModel, durationMs: Date.now() - started, costUsd: out.total_cost_usd });
    });

    child.stdin.end(prompt);
  });
}

// Flattens MCP sampling messages into a single prompt for `claude -p`.
export function samplingMessagesToPrompt(messages = []) {
  const text = (m) => {
    const parts = Array.isArray(m.content) ? m.content : [m.content];
    return parts.map((p) => (p?.type === 'text' ? p.text : `[${p?.type} content omitted]`)).join('\n');
  };
  if (messages.length === 1 && messages[0].role === 'user') return text(messages[0]);
  return messages.map((m) => `<${m.role}>\n${text(m)}\n</${m.role}>`).join('\n\n');
}
