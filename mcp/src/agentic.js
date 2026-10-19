// Agentic job search: plan → search → observe → (re-plan) → rank, with the LLM reached via sampling.

import { searchJobs, compactJob, truncate } from './freehire-api.js';
import { isKnownFilter, vocabularyText, SORTS } from './vocab.js';
import { sample, parseJsonObject, samplingMode } from './sampling.js';

const MIN_PER_ATTEMPT = 10;
const MAX_CANDIDATES = 30; // ranking latency grows with this; 30 keeps it ~10s on haiku
const MAX_ROUNDS = 2;

const plannerSystem = () => `You translate a job seeker's natural-language request (any language) into searches against the freehire.me jobs API.
Today is ${new Date().toISOString().slice(0, 10)}.

Each search has:
- "q": short full-text keywords in ENGLISH (job postings are mostly English). Unquoted words are ORed; wrap words in double quotes to AND them. Keep it to the core role/tech words; never put locations, seniority or work mode in q when a filter exists for it. May be "".
- "q_fields": optional, "title" to match keywords only in the job title (good for role names).
- "filters": object of filter params → string values (comma-separated for OR).
- "sort": optional, one of ${SORTS.join(', ')}; omit for relevance.

${vocabularyText()}

Every filter is ANDed, and the catalogue's enrichment is sparse, so each extra filter cuts recall hard. Rules:
- Hard constraints only. Soft wishes ("ideally", "if possible", "preferably", "idealmente", "si es posible") are NOT filters — the ranking step handles them.
- Never express the same concept twice (e.g. q "react" AND skills "react" AND category "frontend"); pick the single best one (usually "skills" for a technology, "category" for a role family). Leave q empty when filters already capture the request.
- At most 4 filters in the first attempt; avoid q_fields unless the request names an exact job title.
- "X or remote" cannot be one search (geography and work_mode are ANDed): split it into one attempt for the place and one with work_mode=remote (+ a region/country the person can work from).
- Return 2-3 attempts from most specific to broadest; the last one must be broad (1-2 filters) so it surely returns results.

Example — request "junior React in Madrid or remote, visa if possible":
{"intent": "...", "attempts": [
 {"q": "", "q_fields": null, "filters": {"skills": "react", "seniority": "junior", "cities": "Madrid"}, "why": "on-site/hybrid in Madrid"},
 {"q": "", "q_fields": null, "filters": {"skills": "react", "seniority": "junior", "work_mode": "remote", "regions": "eu"}, "why": "remote from the EU"},
 {"q": "", "q_fields": null, "filters": {"skills": "react", "countries": "ES"}, "why": "broad: any React role in Spain"}]}
(visa is a soft wish → left to ranking.)

Respond with ONLY a JSON object:
{"intent": "<one-line restatement, written in the SAME language as the request>", "attempts": [{"q": "...", "q_fields": "title"|null, "filters": {...}, "sort": null, "why": "<short, same language as the request>"}]}`;

const replannerSuffix = `

The previous attempts returned too few results. Use the observed totals and ignored params to propose 2 NEW, broader attempts (different from the ones already tried). Same JSON format.`;

const rankerSystem = `You are a recruiter ranking job postings against a candidate's request.
Score postings 0-100 for how well they fit the request (role, seniority, location/work mode, stack, salary, other stated constraints).
Return the requested number of picks whenever enough candidates exist: partial fits are useful to the candidate, just score them lower and name the gap. Leave out only postings that contradict a hard constraint (wrong role family, wrong country when no remote option was asked for).
Write "summary" and every "reason" in the SAME language as the request. Reasons: one sentence of at most 20 words naming the concrete match or gap. Only list the picks requested.
Respond with ONLY a JSON object:
{"summary": "<2-3 sentences on what you found and any caveat>", "picks": [{"slug": "<slug>", "score": 0-100, "reason": "..."}]}`;

export function sanitizeAttempt(raw) {
  const params = {};
  const dropped = [];
  if (raw.q) params.q = String(raw.q).slice(0, 200);
  if (raw.q_fields === 'title') params.q_fields = 'title';
  if (raw.sort && SORTS.includes(raw.sort)) params.sort = raw.sort;
  for (const [key, value] of Object.entries(raw.filters || {})) {
    if (value === null || value === undefined || value === '') continue;
    if (!isKnownFilter(key)) {
      dropped.push(key);
      continue;
    }
    params[key] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return { params, dropped, why: raw.why || '' };
}

function candidateLine(j) {
  const salary = j.salary ? `${j.salary.min ?? '?'}-${j.salary.max ?? '?'} ${j.salary.currency ?? ''}/${j.salary.period ?? ''}` : 'n/a';
  return `[${j.slug}] ${j.title} — ${j.company} | ${j.location || 'n/a'} | mode:${j.work_mode || 'n/a'} | seniority:${j.seniority || 'n/a'} | salary:${salary} | skills:${j.skills.join(',') || 'n/a'} | ${truncate(j.summary || '', 220)}`;
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ query: string, limit?: number, model?: string }} input
 * @param {{ onStep?: (step: {type: string, message: string, data?: any}) => void, signal?: AbortSignal }} ctx
 */
export async function agenticSearch(server, { query, limit = 10, model = 'haiku' }, { onStep = () => {}, signal } = {}) {
  const steps = [];
  const step = (type, message, data) => {
    const s = { type, message, ...(data ? { data } : {}) };
    steps.push(s);
    onStep(s);
  };

  const via = samplingMode(server);
  step('start', `Agentic search started (LLM via ${via})`, { query, via });

  const candidates = new Map();
  const attempts = [];
  let intent = query;
  let planPrompt = `Request: ${query}`;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    step('plan', round === 1 ? 'Planning searches…' : 'Too few results, re-planning broader searches…');
    const planRes = await sample(server, {
      system: plannerSystem() + (round > 1 ? replannerSuffix : ''),
      prompt: planPrompt,
      maxTokens: 1500,
      model,
      signal,
    });
    const plan = parseJsonObject(planRes.text);
    if (plan.intent) intent = plan.intent;
    step('planned', `Plan ready (${(planRes.durationMs / 1000).toFixed(1)}s, ${planRes.model || model})`, {
      intent,
      attempts: plan.attempts,
    });

    // Share the candidate budget across attempts so a broad first attempt cannot crowd out the rest
    // (e.g. "Madrid or remote" planned as two attempts).
    const planned = (plan.attempts || []).slice(0, 3);
    const perAttempt = Math.max(MIN_PER_ATTEMPT, Math.ceil(MAX_CANDIDATES / Math.max(planned.length, 1)));
    for (const raw of planned) {
      if (candidates.size >= MAX_CANDIDATES) break;
      const { params, dropped, why } = sanitizeAttempt(raw);
      let res = await searchJobs({ ...params, limit: perAttempt }, { signal });
      // Cheap self-correction without another LLM round: keywords ANDed on top of filters are the
      // most common cause of an empty page, so retry once without them.
      if (!res.meta?.total && params.q && Object.keys(params).some((k) => !['q', 'q_fields', 'sort'].includes(k))) {
        step('relax', `0 matches for "${params.q}" + filters → retrying without keywords`);
        delete params.q;
        delete params.q_fields;
        res = await searchJobs({ ...params, limit: perAttempt }, { signal });
      }
      const jobs = (res.data || []).map((j) => compactJob(j));
      let added = 0;
      for (const j of jobs) {
        if (!candidates.has(j.slug) && candidates.size < MAX_CANDIDATES) {
          candidates.set(j.slug, j);
          added++;
        }
      }
      const ignored = [...dropped, ...(res.meta?.ignored_params || []).map((p) => p.param ?? p)];
      const attempt = { round, params, why, total: res.meta?.total ?? jobs.length, returned: jobs.length, added, ignored };
      attempts.push(attempt);
      step('search', `Search ${params.q ? `"${params.q}"` : '(filters only)'} → ${attempt.total} matches (+${added} new)`, attempt);
    }

    if (candidates.size >= Math.min(limit, 5)) break;
    planPrompt = `Request: ${query}\n\nAttempts already tried and their total matches:\n${attempts
      .map((a) => `- ${JSON.stringify(a.params)} → ${a.total}${a.ignored.length ? ` (ignored params: ${a.ignored.join(', ')})` : ''}`)
      .join('\n')}`;
  }

  if (candidates.size === 0) {
    step('done', 'No postings matched any attempt.');
    return { query, intent, via, summary: 'No matching postings found.', attempts, results: [], steps };
  }

  step('rank', `Ranking ${candidates.size} candidates…`);
  let results;
  let summary = '';
  try {
    const rankRes = await sample(server, {
      system: rankerSystem,
      prompt: `Request: ${query}\n\nPostings:\n${[...candidates.values()].map(candidateLine).join('\n')}\n\nReturn at most ${limit} picks, best first.`,
      maxTokens: 3000,
      model,
      signal,
    });
    const ranked = parseJsonObject(rankRes.text);
    summary = ranked.summary || '';
    results = (ranked.picks || [])
      .filter((p) => candidates.has(p.slug))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit)
      .map((p) => ({ ...candidates.get(p.slug), score: p.score ?? null, reason: p.reason || '' }));
    step('ranked', `Ranked (${(rankRes.durationMs / 1000).toFixed(1)}s): ${results.length} picks`);
  } catch (err) {
    step('rank_failed', `Ranking failed (${err.message}); returning search order`);
    results = [...candidates.values()].slice(0, limit).map((j) => ({ ...j, score: null, reason: '' }));
  }

  step('done', `Done: ${results.length} results`);
  return { query, intent, via, summary, attempts, results, steps };
}
