import { useEffect, useState } from 'react';
import { getJob, similarJobs } from './api.js';

const WORK_MODE = { remote: 'Remoto', hybrid: 'Híbrido', onsite: 'Presencial' };
const PERIOD = { year: 'año', month: 'mes', day: 'día', hour: 'hora' };

export function formatSalary(s) {
  if (!s) return null;
  const fmt = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const range = s.min && s.max && s.min !== s.max ? `${fmt(s.min)}–${fmt(s.max)}` : fmt(s.min || s.max);
  return `${range} ${s.currency || ''}${s.period ? ` / ${PERIOD[s.period] || s.period}` : ''}`.trim();
}

export function timeAgo(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} d`;
  return `hace ${Math.floor(days / 30)} m`;
}

export function ScoreRing({ score }) {
  if (score == null) return null;
  const tone = score >= 75 ? 'good' : score >= 50 ? 'mid' : 'low';
  return (
    <div className={`score score--${tone}`} style={{ '--p': score }} title={`Encaje ${score}/100`}>
      <span>{score}</span>
    </div>
  );
}

export function JobCard({ job, onOpen, rank }) {
  const salary = formatSalary(job.salary);
  return (
    <article className="card" onClick={() => onOpen(job.slug)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(job.slug)}>
      <div className="card__main">
        <div className="card__head">
          {rank != null && <span className="card__rank">{String(rank).padStart(2, '0')}</span>}
          <div>
            <h3 className="card__title">{job.title}</h3>
            <p className="card__company">
              {job.company}
              <span className="dot">·</span>
              <span className="muted">{job.location || 'Ubicación no indicada'}</span>
            </p>
          </div>
        </div>
        {job.reason && <p className="card__reason">{job.reason}</p>}
        <div className="tags">
          {job.work_mode && <span className="tag tag--accent">{WORK_MODE[job.work_mode] || job.work_mode}</span>}
          {job.seniority && <span className="tag">{job.seniority}</span>}
          {salary && <span className="tag tag--money">{salary}</span>}
          {job.visa_sponsorship && <span className="tag">visado</span>}
          {job.skills.slice(0, 5).map((s) => (
            <span key={s} className="tag tag--ghost">{s}</span>
          ))}
          {job.posted_at && <span className="tag tag--ghost">{timeAgo(job.posted_at)}</span>}
        </div>
      </div>
      <ScoreRing score={job.score} />
    </article>
  );
}

const STEP_ICON = {
  start: '◆', plan: '◇', planned: '✓', search: '⌕', relax: '↺', rank: '◇', ranked: '✓', rank_failed: '!', done: '■',
};

export function AgentTrace({ steps, sampling, running }) {
  const llmCalls = sampling.filter((s) => s.phase === 'done');
  const cost = llmCalls.reduce((a, s) => a + (s.costUsd || 0), 0);
  const llmMs = llmCalls.reduce((a, s) => a + (s.durationMs || 0), 0);
  const pending = sampling.length > 0 && sampling[sampling.length - 1].phase === 'start';
  return (
    <aside className="trace">
      <div className="trace__head">
        <h2>Razonamiento del agente</h2>
        {running && <span className="pulse" aria-label="en curso" />}
      </div>
      <div className="trace__stats">
        <div><b>{llmCalls.length}</b><span>llamadas sampling</span></div>
        <div><b>{(llmMs / 1000).toFixed(1)}s</b><span>tiempo LLM</span></div>
        <div><b>${cost.toFixed(3)}</b><span>equivalente API*</span></div>
      </div>
      {steps.length === 0 && <p className="muted small">Lanza una búsqueda para ver cómo el agente planifica, consulta freehire y ordena resultados.</p>}
      <ol className="trace__list">
        {steps.map((s, i) => (
          <li key={i} className={`step step--${s.type}`}>
            <span className="step__icon">{STEP_ICON[s.type] || '•'}</span>
            <div>
              <p>{s.message}</p>
              {s.type === 'planned' && s.data?.intent && <p className="step__intent">“{s.data.intent}”</p>}
              {s.type === 'search' && s.data && (
                <div className="step__params">
                  {Object.entries(s.data.params).map(([k, v]) => (
                    <code key={k}>{k}={v}</code>
                  ))}
                  {s.data.why && <p className="muted small">{s.data.why}</p>}
                </div>
              )}
            </div>
          </li>
        ))}
        {pending && (
          <li className="step step--thinking">
            <span className="step__icon">✦</span>
            <p>Claude Code local pensando ({sampling[sampling.length - 1].model})…</p>
          </li>
        )}
      </ol>
      <p className="trace__foot muted small">* Coste estimado que reporta Claude Code; se consume de tu suscripción local, sin API key.</p>
    </aside>
  );
}

export function JobDrawer({ slug, onClose, onOpen }) {
  const [job, setJob] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setJob(null);
    setSimilar([]);
    setError(null);
    getJob(slug).then((j) => alive && setJob(j)).catch((e) => alive && setError(e.message));
    similarJobs(slug).then((s) => alive && setSimilar(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!slug) return null;
  const salary = job && formatSalary(job.salary);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <section className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="drawer__close" onClick={onClose} aria-label="Cerrar">✕</button>
        {error && <p className="error">{error}</p>}
        {!job && !error && <div className="skeleton" />}
        {job && (
          <>
            <p className="eyebrow">{job.company}</p>
            <h2 className="drawer__title">{job.title}</h2>
            <p className="muted">{job.location}</p>
            <div className="tags">
              {job.work_mode && <span className="tag tag--accent">{WORK_MODE[job.work_mode] || job.work_mode}</span>}
              {job.seniority && <span className="tag">{job.seniority}</span>}
              {job.category && <span className="tag">{job.category}</span>}
              {job.employment_type && <span className="tag">{job.employment_type}</span>}
              {salary && <span className="tag tag--money">{salary}</span>}
              {job.english_level && <span className="tag">inglés {job.english_level}</span>}
              {job.closed_at && <span className="tag tag--warn">cerrada</span>}
            </div>
            <a className="btn btn--primary" href={job.url} target="_blank" rel="noreferrer">
              Ver oferta original ↗
            </a>
            {job.enrichment?.summary && <p className="drawer__summary">{job.enrichment.summary}</p>}
            <pre className="drawer__desc">{job.description}</pre>
            {similar.length > 0 && (
              <>
                <h3 className="drawer__sub">Ofertas similares</h3>
                <ul className="similar">
                  {similar.map((s) => (
                    <li key={s.slug}>
                      <button onClick={() => onOpen(s.slug)}>
                        <b>{s.title}</b>
                        <span className="muted"> · {s.company}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
