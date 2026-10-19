import { useCallback, useEffect, useRef, useState } from 'react';
import { agenticSearch, getConfig, health, searchJobs } from './api.js';
import { AgentTrace, JobCard, JobDrawer } from './components.jsx';
import { SettingsPanel } from './settings.jsx';

const EXAMPLES = [
  'Backend senior con Python en remoto desde España, idealmente fintech',
  'Frontend React junior en Madrid o remoto en Europa',
  'Data engineer con Spark y AWS, más de 70k €, con visado si es posible',
  'Staff/Principal Go engineer en startups YC, 100% remoto',
];

const HISTORY_KEY = 'freehire.history';
const loadHistory = () => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
};
const saveHistory = (h) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* private mode: history is a convenience only */
  }
};

function AiSearch({ onOpen }) {
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('haiku');
  const [limit, setLimit] = useState(10);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [sampling, setSampling] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const abortRef = useRef(null);

  const run = useCallback(
    async (q) => {
      const text = (q ?? query).trim();
      if (text.length < 3 || running) return;
      setQuery(text);
      setRunning(true);
      setSteps([]);
      setSampling([]);
      setResult(null);
      setError(null);
      const next = [text, ...history.filter((h) => h !== text)].slice(0, 8);
      setHistory(next);
      saveHistory(next);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await agenticSearch(
          { query: text, limit, model },
          {
            signal: ctrl.signal,
            onEvent: (event, data) => {
              if (event === 'step') setSteps((s) => [...s, data]);
              else if (event === 'sampling') setSampling((s) => [...s, data]);
              else if (event === 'result') setResult(data);
              else if (event === 'error') setError(data.message);
            },
          },
        );
      } catch (e) {
        if (e.name !== 'AbortError') setError(e.message);
      } finally {
        setRunning(false);
      }
    },
    [query, running, history, limit, model],
  );

  const stop = () => abortRef.current?.abort();

  return (
    <div className="ai">
      <div className="ai__main">
        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run();
              }
            }}
            placeholder="Describe el trabajo que buscas: rol, stack, seniority, ubicación, salario, tipo de empresa…"
            rows={3}
            autoFocus
          />
          <div className="prompt__bar">
            <div className="prompt__opts">
              <label>
                Modelo
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>
                  <option value="haiku">Haiku · rápido</option>
                  <option value="sonnet">Sonnet · equilibrado</option>
                  <option value="opus">Opus · máximo</option>
                </select>
              </label>
              <label>
                Resultados
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} disabled={running}>
                  {[5, 10, 15, 20].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            {running ? (
              <button type="button" className="btn" onClick={stop}>Detener</button>
            ) : (
              <button type="submit" className="btn btn--primary" disabled={query.trim().length < 3}>
                Buscar con IA <kbd>↵</kbd>
              </button>
            )}
          </div>
        </form>

        {!result && !running && (
          <div className="chips">
            {(history.length ? history : EXAMPLES).map((ex) => (
              <button key={ex} className="chip" onClick={() => run(ex)}>{ex}</button>
            ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {running && !result && (
          <div className="loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton skeleton--card" />
            ))}
          </div>
        )}

        {result && (
          <section>
            <div className="summary">
              <p className="eyebrow">Interpretación</p>
              <h2>{result.intent}</h2>
              {result.summary && <p>{result.summary}</p>}
              <p className="muted small">
                {result.attempts.length} búsquedas · {result.results.length} resultados · LLM vía{' '}
                {result.via === 'mcp-sampling' ? 'MCP sampling → Claude Code local' : 'Claude Code CLI'}
              </p>
            </div>
            <div className="list">
              {result.results.map((job, i) => (
                <JobCard key={job.slug} job={job} rank={i + 1} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )}
      </div>
      <AgentTrace steps={steps} sampling={sampling} running={running} />
    </div>
  );
}

const FILTERS = [
  { key: 'work_mode', label: 'Modalidad', options: { remote: 'Remoto', hybrid: 'Híbrido', onsite: 'Presencial' } },
  { key: 'seniority', label: 'Seniority', options: { intern: 'Intern', junior: 'Junior', middle: 'Middle', senior: 'Senior', lead: 'Lead', staff: 'Staff', principal: 'Principal' } },
  {
    key: 'category',
    label: 'Especialidad',
    options: { backend: 'Backend', frontend: 'Frontend', fullstack: 'Fullstack', mobile: 'Mobile', devops: 'DevOps', sre: 'SRE', data_engineering: 'Data eng.', data_science: 'Data science', ml_ai: 'ML / AI', ai_engineering: 'AI eng.', qa: 'QA', security: 'Security', product: 'Product', design: 'Design' },
  },
  { key: 'regions', label: 'Región', options: { eu: 'Europa', uk: 'UK', north_america: 'Norteamérica', latam: 'LatAm', apac: 'APAC', global: 'Global' } },
];

function ManualSearch({ onOpen }) {
  const [form, setForm] = useState({ q: '', countries: '', skills: '' });
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const LIMIT = 20;

  const load = useCallback(
    async (nextOffset = 0) => {
      setLoading(true);
      setError(null);
      try {
        setData(await searchJobs({ ...form, countries: form.countries.toUpperCase(), skills: form.skills.toLowerCase(), limit: LIMIT, offset: nextOffset }));
        setOffset(nextOffset);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [form],
  );

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="manual">
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          load(0);
        }}
      >
        <input className="filters__q" value={form.q} onChange={set('q')} placeholder="Palabras clave (p. ej. golang kubernetes)" />
        <input value={form.skills} onChange={set('skills')} placeholder="Skills (go,react)" />
        <input value={form.countries} onChange={set('countries')} placeholder="Países ISO (ES,PT)" />
        {FILTERS.map((f) => (
          <select key={f.key} value={form[f.key] || ''} onChange={set(f.key)}>
            <option value="">{f.label}</option>
            {Object.entries(f.options).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        ))}
        <select value={form.sort || ''} onChange={set('sort')}>
          <option value="">Relevancia</option>
          <option value="posted_at">Más recientes</option>
          <option value="salary_max">Mayor salario</option>
        </select>
        <button className="btn btn--primary" disabled={loading}>Buscar</button>
      </form>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p className="muted small">
            {data.total?.toLocaleString('es-ES')} ofertas
            {data.ignored_params?.length > 0 && ` · parámetros ignorados: ${data.ignored_params.map((p) => p.param ?? p).join(', ')}`}
          </p>
          <div className="list">
            {data.jobs.map((job) => (
              <JobCard key={job.slug} job={job} onOpen={onOpen} />
            ))}
          </div>
          <div className="pager">
            <button className="btn" disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - LIMIT))}>← Anterior</button>
            <span className="muted small">{offset + 1}–{offset + data.jobs.length}</span>
            <button className="btn" disabled={offset + LIMIT >= (data.total || 0) || loading} onClick={() => load(offset + LIMIT)}>Siguiente →</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState('ai');
  const [openSlug, setOpenSlug] = useState(null);
  const [status, setStatus] = useState({ state: 'checking' });
  const [config, setConfig] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    health()
      .then((h) => setStatus({ state: h.ok ? 'ok' : 'down', tools: h.tools?.length }))
      .catch((e) => setStatus({ state: 'down', error: e.message }));
  }, []);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
  }, []);

  const close = useCallback(() => setOpenSlug(null), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand__mark">f</span>
          <div>
            <b>freehire</b>
            <span className="muted"> · buscador agéntico</span>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'ai'} className={mode === 'ai' ? 'active' : ''} onClick={() => setMode('ai')}>✦ IA</button>
          <button role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>Filtros</button>
        </nav>
        <button className="btn" onClick={openSettings}>⚙ Ajustes</button>
        <span className={`status status--${status.state}`} title={status.error || ''}>
          {status.state === 'ok' ? `MCP conectado · ${status.tools} tools` : status.state === 'checking' ? 'Conectando…' : 'Bridge caído'}
        </span>
      </header>
      {/* Both stay mounted so switching tabs keeps each one's results. */}
      <main>
        <div hidden={mode !== 'ai'}><AiSearch onOpen={setOpenSlug} /></div>
        <div hidden={mode !== 'manual'}><ManualSearch onOpen={setOpenSlug} /></div>
      </main>
      <JobDrawer slug={openSlug} onClose={close} onOpen={setOpenSlug} config={config} openSettings={openSettings} />
      <SettingsPanel open={settingsOpen} onClose={closeSettings} onChange={setConfig} />
    </div>
  );
}
