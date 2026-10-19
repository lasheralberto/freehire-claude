// LLM access for the agentic search. Primary path is MCP sampling (`sampling/createMessage`): the
// connected client — our web bridge, which forwards to the local Claude Code — runs the model.
// If the client did not advertise sampling, fall back to calling the local `claude` CLI directly,
// so the tool still works from hosts without sampling support. No API key either way.

import { runClaude } from './claude-cli.js';

const FALLBACK_ENABLED = process.env.FREEHIRE_SAMPLING_FALLBACK !== 'off';

export function samplingMode(server) {
  if (server.server.getClientCapabilities()?.sampling) return 'mcp-sampling';
  return FALLBACK_ENABLED ? 'claude-cli' : null;
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ system: string, prompt: string, maxTokens?: number, model?: string, signal?: AbortSignal }} req
 */
export async function sample(server, { system, prompt, maxTokens = 2000, model = 'haiku', signal }) {
  const mode = samplingMode(server);
  const started = Date.now();
  if (mode === 'mcp-sampling') {
    const res = await server.server.createMessage(
      {
        systemPrompt: system,
        messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
        maxTokens,
        modelPreferences: { hints: [{ name: model }], speedPriority: 0.8, intelligencePriority: 0.5 },
        includeContext: 'none',
      },
      { signal, timeout: 180_000 },
    );
    const content = Array.isArray(res.content) ? res.content : [res.content];
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { text, via: mode, model: res.model, durationMs: Date.now() - started };
  }
  if (mode === 'claude-cli') {
    const res = await runClaude({ prompt, systemPrompt: system, model, signal });
    return { text: res.text, via: mode, model: res.model, durationMs: res.durationMs };
  }
  throw new Error('The MCP client does not support sampling and the local claude fallback is disabled.');
}

// Models sometimes wrap JSON in prose or code fences; take the outermost object.
export function parseJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}
