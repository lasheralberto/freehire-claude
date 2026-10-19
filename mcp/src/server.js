// MCP server exposing the freehire.me jobs catalogue plus an agentic, sampling-backed search.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as api from './freehire-api.js';
import { isKnownFilter, vocabularyText, SORTS } from './vocab.js';
import { agenticSearch } from './agentic.js';

const filterValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
const filtersSchema = z
  .record(z.string(), filterValue)
  .optional()
  .describe('Search filters, e.g. {"seniority":"senior","work_mode":"remote","countries":"ES","skills":"go,rust"}. See the freehire://vocabulary resource for every param and value.');

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: `freehire error: ${err.message}` }] });

function splitFilters(filters = {}) {
  const params = {};
  const unknown = [];
  for (const [k, v] of Object.entries(filters)) {
    if (isKnownFilter(k)) params[k] = Array.isArray(v) ? v.join(',') : v;
    else unknown.push(k);
  }
  return { params, unknown };
}

export function createServer() {
  const server = new McpServer(
    { name: 'freehire', version: '0.1.0' },
    {
      capabilities: { logging: {} },
      instructions:
        'Search 3M+ live IT job postings from freehire.me (crawled straight from company ATSs). ' +
        'Use agentic_search for natural-language requests ("senior Go remote in Spain over 60k"): it plans filters, ' +
        'searches, relaxes when needed and ranks results with an LLM obtained via MCP sampling. ' +
        'Use search_jobs / job_facets for precise, filter-driven queries and get_job for full details.',
    },
  );

  server.registerResource(
    'vocabulary',
    'freehire://vocabulary',
    { title: 'Search filter vocabulary', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, text: vocabularyText() }] }),
  );

  server.registerTool(
    'agentic_search',
    {
      title: 'Agentic job search (AI)',
      description:
        'Natural-language job search in any language. An LLM (via MCP sampling to the client, falling back to the local Claude Code CLI) ' +
        'turns the request into filtered searches, widens them if results are thin, then ranks and explains the best matches.',
      inputSchema: {
        query: z.string().min(3).describe('What the candidate is looking for, in their own words.'),
        limit: z.number().int().min(1).max(25).optional().describe('Max ranked results (default 10).'),
        model: z.enum(['haiku', 'sonnet', 'opus']).optional().describe('Model preference hint (default haiku).'),
      },
    },
    async ({ query, limit, model }, extra) => {
      const progressToken = extra._meta?.progressToken;
      let n = 0;
      const onStep = (s) => {
        server.sendLoggingMessage({ level: 'info', logger: 'agentic_search', data: s }, extra.sessionId).catch(() => {});
        if (progressToken !== undefined) {
          extra
            .sendNotification({ method: 'notifications/progress', params: { progressToken, progress: ++n, message: s.message } })
            .catch(() => {});
        }
      };
      try {
        const result = await agenticSearch(server, { query, limit, model }, { onStep, signal: extra.signal });
        const lines = result.results.map(
          (r, i) =>
            `${i + 1}. **${r.title}** — ${r.company} (${r.location || 'n/a'})${r.score != null ? ` · ${r.score}/100` : ''}\n   ${r.reason || r.summary || ''}\n   ${r.url} · slug: ${r.slug}`,
        );
        const text = `**${result.intent}**\n\n${result.summary}\n\n${lines.join('\n') || 'No results.'}`;
        return { content: [{ type: 'text', text }], structuredContent: result };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'search_jobs',
    {
      title: 'Search jobs',
      description: 'Full-text + faceted search over open postings (GET /jobs/search). Returns compact job cards and the total match count.',
      inputSchema: {
        q: z.string().optional().describe('Full-text keywords (OR of stemmed tokens; quote words to AND them).'),
        q_fields: z.string().optional().describe('Restrict q to a subset of title,company,description,location (e.g. "title").'),
        filters: filtersSchema,
        sort: z.enum(SORTS).optional(),
        order: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ q, q_fields, filters, sort, order, limit = 20, offset = 0 }, extra) => {
      try {
        const { params, unknown } = splitFilters(filters);
        const res = await api.searchJobs({ q, q_fields, sort, order, limit, offset, ...params }, { signal: extra.signal });
        return json({
          total: res.meta?.total,
          limit,
          offset,
          ignored_params: [...unknown, ...(res.meta?.ignored_params || [])],
          jobs: (res.data || []).map((j) => api.compactJob(j)),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'job_facets',
    {
      title: 'Job facet counts',
      description: 'How many open postings match per facet value for a query/filters (GET /jobs/facets). Use to explore the market or pick filters.',
      inputSchema: { q: z.string().optional(), filters: filtersSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ q, filters }, extra) => {
      try {
        const res = await api.jobFacets({ q, ...splitFilters(filters).params }, { signal: extra.signal });
        return json(res.data);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_job',
    {
      title: 'Get job',
      description: 'Full details of one posting by slug, including the description as plain text.',
      inputSchema: {
        slug: z.string(),
        max_description_chars: z.number().int().min(200).max(50_000).optional().describe('Default 8000.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ slug, max_description_chars = 8000 }, extra) => {
      try {
        const { data } = await api.getJob(slug, { signal: extra.signal });
        return json({
          ...api.compactJob(data),
          closed_at: data.closed_at,
          enrichment: data.enrichment,
          description: api.truncate(api.stripHtml(data.description), max_description_chars),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'similar_jobs',
    {
      title: 'Similar jobs',
      description: 'Semantically similar open postings to a given job (may be empty).',
      inputSchema: { slug: z.string(), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ slug, limit = 10 }, extra) => {
      try {
        const res = await api.similarJobs(slug, limit, { signal: extra.signal });
        return json((res.data || []).map((j) => api.compactJob(j)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'search_companies',
    {
      title: 'Search companies',
      description: 'List hiring companies with open-job counts (GET /companies). Filters: collections, regions, countries, industries, domains, company_type, company_size, remote_regions, maturity…',
      inputSchema: {
        q: z.string().optional().describe('Case-insensitive company-name substring.'),
        filters: z.record(z.string(), filterValue).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ q, filters = {}, limit = 20, offset = 0 }, extra) => {
      try {
        const res = await api.searchCompanies({ q, limit, offset, ...filters }, { signal: extra.signal });
        return json({
          total: res.meta?.total,
          companies: (res.data || []).map(({ company_info, ...c }) => c),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_company',
    {
      title: 'Get company',
      description: 'A company profile and a page of its open jobs.',
      inputSchema: { slug: z.string(), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ slug, limit = 20 }, extra) => {
      try {
        const { data } = await api.getCompany(slug, { limit }, { signal: extra.signal });
        return json({ company: data.company, jobs: (data.jobs || []).map((j) => api.compactJob(j)) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
