// Search-filter vocabulary of GET /jobs/search, copied from freehire's docs/API.md ("Filtering jobs").
// The planner prompt is built from this, and planner output is validated against it.

export const FACETS = {
  collections: 'yc, techstars, a16z-portfolio, a16z-speedrun, european, ai, mag7, bigtech, unicorn, fortune500, eastern-roots, indian-roots, ai-native, uk-skilled-worker-sponsor, nl-recognised-sponsor, us-h1b-sponsor',
  regions: 'global, north_america, latam, eu, uk, mena, africa, apac, cis, none',
  work_mode: 'remote, hybrid, onsite',
  category: 'software_engineering, backend, frontend, fullstack, mobile, devops, sre, network_engineering, data_engineering, data_science, data_analytics, ml_ai, ai_engineering, qa, security, hardware, embedded, blockchain, architecture, design, creative, engineering_design, industrial_engineering, occupational_safety, product, project_management, healthcare, skilled_trades, retail, hospitality, logistics, education, personal_services, administration, social_services, science, manufacturing, public_safety, marketing, sales, support, business_analysis, solutions_engineering, developer_relations, technical_writing, recruiting, hr, finance, legal, operations, customer_success, other',
  ai_archetype: 'rag_app_builder, agent_builder, cloud_ml_platform_engineer, ml_trainer_researcher, fullstack_ai_engineer, devops_infra_engineer',
  seniority: 'intern, junior, middle, senior, lead, staff, principal, c_level',
  role_type: 'people_manager',
  skills: 'open vocabulary, lowercase (e.g. go, python, react, kubernetes, postgresql, typescript, aws)',
  domains: 'fintech, crypto, ecommerce, gambling, gamedev, media, travel, healthcare, edtech, govtech, devtools, cybersecurity, ai, hrtech, adtech, proptech, logistics, mobility, climatetech, other',
  company_type: 'product, startup, outsource, outstaff, agency, inhouse, government',
  countries: 'ISO 3166-1 alpha-2 codes (e.g. ES, DE, US, GB, PT)',
  cities: 'open vocabulary, English city names (e.g. Madrid, Berlin, London)',
  relocation: 'not_supported, supported, required',
  employment_type: 'full_time, part_time, contract, internship, fellowship',
  english_level: 'none, a1, a2, b1, b2, c1, c2, native',
  posting_language: 'ISO 639-1 codes (e.g. en, es, de)',
  reality: 'fresh, stale, likely-evergreen',
  salary_currency: 'USD, EUR, GBP, RUB',
  company_slug: 'open vocabulary (company slug)',
  company_size: '1-10, 11-50, 51-200, 201-500, 501-1000, 1000+',
  education_level: 'none, bachelor, master, phd',
  salary_period: 'year, month, day, hour',
};

export const SCALARS = {
  visa_sponsorship: 'true | false',
  requires_clearance: 'true | false',
  salary_min: 'integer — minimum salary at least this (pair with salary_currency)',
  salary_max: 'integer — maximum salary at most this (pair with salary_currency)',
  experience_years_min: 'integer',
  experience_years_max: 'integer (0 = no prior experience required)',
  posted_within_days: 'integer — source posting date within N days',
  open_within_days: 'integer — first seen by freehire within N days',
};

const FACET_NAMES = Object.keys(FACETS);
const MODIFIER_SUFFIXES = ['_mode', '_exclude'];

export const SORTS = ['created_at', 'posted_at', 'view_count', 'salary_min', 'salary_max'];

export function isKnownFilter(name) {
  if (FACET_NAMES.includes(name) || name in SCALARS) return true;
  return MODIFIER_SUFFIXES.some((s) => name.endsWith(s) && FACET_NAMES.includes(name.slice(0, -s.length)));
}

export function vocabularyText() {
  const facets = Object.entries(FACETS).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const scalars = Object.entries(SCALARS).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return `Facet filters (comma-separated values are ORed; add "<facet>_mode": "and" to require all; "<facet>_exclude": "<value>" to exclude):
${facets}

Numeric / boolean filters:
${scalars}

Geography rule: regions, countries and cities form ONE OR-group (they widen each other). To target one country use only "countries", never together with its region.`;
}
