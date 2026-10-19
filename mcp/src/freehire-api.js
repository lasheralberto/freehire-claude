// Thin client for the public, keyless freehire.me API (https://freehire.me/docs/api).

const BASE_URL = (process.env.FREEHIRE_API_URL || 'https://freehire.me/api/v1').replace(/\/$/, '');
const API_KEY = process.env.FREEHIRE_API_KEY; // optional; public endpoints need none

export class FreehireError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function toQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function apiGet(path, params, { signal } = {}) {
  const url = `${BASE_URL}${path}${toQuery(params)}`;
  const res = await fetch(url, {
    signal,
    headers: {
      accept: 'application/json',
      'user-agent': 'freehire-agentic-search-mcp/0.1',
      ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new FreehireError(body.error || `HTTP ${res.status} on ${path}`, res.status);
  return body;
}

export const searchJobs = (params, opts) => apiGet('/jobs/search', params, opts);
export const jobFacets = (params, opts) => apiGet('/jobs/facets', params, opts);
export const getJob = (slug, opts) => apiGet(`/jobs/${encodeURIComponent(slug)}`, {}, opts);
export const similarJobs = (slug, limit, opts) =>
  apiGet(`/jobs/${encodeURIComponent(slug)}/similar`, { limit }, opts);
export const searchCompanies = (params, opts) => apiGet('/companies', params, opts);
export const getCompany = (slug, params, opts) =>
  apiGet(`/companies/${encodeURIComponent(slug)}`, params, opts);

export function stripHtml(html = '') {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function truncate(text = '', max = 400) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// The wire job carries the full description and ~40 fields; agents and the UI need a fraction.
export function compactJob(job, { descriptionChars = 280 } = {}) {
  const e = job.enrichment || {};
  return {
    slug: job.public_slug,
    title: job.title,
    company: job.company,
    company_slug: job.company_slug,
    location: job.location,
    url: job.url,
    work_mode: job.work_mode || null,
    countries: job.countries || [],
    regions: job.regions || [],
    skills: (job.skills || []).slice(0, 12),
    seniority: e.seniority || null,
    category: e.category || null,
    employment_type: e.employment_type || null,
    company_type: e.company_type || null,
    visa_sponsorship: e.visa_sponsorship ?? null,
    relocation: e.relocation || null,
    english_level: e.english_level || null,
    salary:
      e.salary_min || e.salary_max
        ? { min: e.salary_min ?? null, max: e.salary_max ?? null, currency: e.salary_currency || null, period: e.salary_period || null }
        : null,
    posted_at: job.posted_at || job.created_at || null,
    reality: job.reality?.class || null,
    summary: e.summary || truncate(stripHtml(job.description), descriptionChars),
  };
}
