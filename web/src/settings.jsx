import { useEffect, useState } from 'react';
import { getConfig, saveConfig, uploadCvBase } from './api.js';

export function SettingsPanel({ open, onClose, onChange }) {
  const [config, setConfig] = useState(null);
  const [dataDir, setDataDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const apply = (c) => {
    setConfig(c);
    setDataDir(c.dataDir || '');
    onChange?.(c);
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    getConfig().then(apply).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveDir = () => run(async () => apply(await saveConfig({ dataDir: dataDir.trim() })));
  const saveModel = (docModel) => run(async () => apply(await saveConfig({ docModel })));
  const upload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    run(async () => {
      await uploadCvBase(file);
      apply(await getConfig());
    });
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <section className="drawer settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="drawer__close" onClick={onClose} aria-label="Cerrar">✕</button>
        <h2 className="drawer__title">Ajustes</h2>

        <label>
          Carpeta de datos
          <span className="settings__row">
            <input value={dataDir} onChange={(e) => setDataDir(e.target.value)} placeholder="C:\ruta\a\mis\documentos" />
            <button className="btn btn--primary" onClick={saveDir} disabled={busy || !dataDir.trim()}>Guardar</button>
          </span>
        </label>

        <label>
          Modelo para CV y cover letter
          <select value={config?.docModel || ''} onChange={(e) => saveModel(e.target.value)} disabled={busy || !config}>
            {(config?.models || []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>

        <label>
          Subir CV base (PDF)
          <input type="file" accept="application/pdf" onChange={upload} disabled={busy || !config?.dataDir} />
        </label>
        <p className="muted small">
          {config?.hasCvBase
            ? `CV base cargado · puedes revisar/corregir el texto en ${config.cvBaseMdPath}`
            : 'Aún no has subido tu CV base'}
        </p>

        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
