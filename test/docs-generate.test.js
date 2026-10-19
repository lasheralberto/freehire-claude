import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateDocument } from '../server/docs/generate.js';
import { buildCvPrompt, buildLetterPrompt } from '../server/docs/prompts.js';
import { CV_BASE_DIR } from '../server/docs/paths.js';
import { readCvBase } from '../server/docs/cv-base.js';

const job = { title: 'Dev', company: 'Acme', description: '...' };
const getJob = async () => job;
const BASE = 'Jane Doe\nExperience at Globex 2019 - 2023. Education: Uni Madrid 2015 2019.';

const cvJson = (company) => JSON.stringify({
  language: 'en', name: 'Jane Doe', headline: 'Dev', contact: { email: 'j@x.com', phone: '', location: '', links: [] },
  headings: { summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', certifications: 'Certs', languages: 'Languages' },
  summary: 's', skills: ['JS'],
  experience: [{ title: 'Dev', company, location: '', start: '2019', end: '2023', bullets: ['did x'] }],
  education: [], certifications: [], languages: [],
});
const letterJson = JSON.stringify({
  language: 'en', name: 'Jane Doe', contact: { email: 'j@x.com', phone: '', location: '', links: [] },
  date: '19 October 2026', recipient: 'Acme', greeting: 'Dear team,', paragraphs: ['One.', 'Two.'],
  closing: 'Regards,', signature: 'Jane Doe',
});

async function setup(withBase = true) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fh-gen-'));
  if (withBase) {
    await mkdir(path.join(dataDir, CV_BASE_DIR), { recursive: true });
    await writeFile(path.join(dataDir, CV_BASE_DIR, 'cv-base.md'), BASE);
  }
  return dataDir;
}
const fake = (...replies) => {
  const calls = [];
  const fn = async (o) => { calls.push(o); const r = replies[Math.min(calls.length - 1, replies.length - 1)]; return { text: r, model: 'm' }; };
  fn.calls = calls;
  return fn;
};

test('rejects 409 without dataDir', async () => {
  await assert.rejects(generateDocument({ kind: 'cv', slug: 's', config: { dataDir: null }, getJob, runClaude: fake('') }), { status: 409 });
});

test('rejects 409 without CV base', async (t) => {
  const dataDir = await setup(false);
  await assert.rejects(generateDocument({ kind: 'cv', slug: 's', config: { dataDir, docModel: 'sonnet' }, getJob, runClaude: fake('') }),
    (e) => e.status === 409 && e.message.includes('CV base'));
});

test('cv happy path', async () => {
  const dataDir = await setup();
  assert.ok(await readCvBase(dataDir), 'fixture base readable');
  const config = { dataDir, docModel: 'sonnet' };
  const rc = fake('```json\n' + cvJson('Globex') + '\n```');
  const r = await generateDocument({ kind: 'cv', slug: 'acme-dev', config, getJob, runClaude: rc });
  assert.equal(r.file, 'cv.pdf');
  assert.deepEqual(r.warnings, []);
  const buf = await readFile(path.join(dataDir, 'acme-dev', 'cv.pdf'));
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(rc.calls[0].model, 'sonnet');
  assert.equal(rc.calls[0].timeoutMs, 300000);
});

test('invented company warns but writes', async () => {
  const dataDir = await setup();
  const r = await generateDocument({ kind: 'cv', slug: 's', config: { dataDir, docModel: 'sonnet' }, getJob, runClaude: fake(cvJson('Initech')) });
  assert.equal(r.warnings.length, 1);
  assert.ok((await readFile(r.path)).length > 0);
});

test('retries once on invalid output', async () => {
  const dataDir = await setup();
  const rc = fake('lo siento', cvJson('Globex'));
  await generateDocument({ kind: 'cv', slug: 's', config: { dataDir, docModel: 'sonnet' }, getJob, runClaude: rc });
  assert.equal(rc.calls.length, 2);
  assert.ok(rc.calls[1].prompt.includes('SOLO el objeto JSON'));
});

test('502 when retry also fails', async () => {
  const dataDir = await setup();
  await assert.rejects(generateDocument({ kind: 'cv', slug: 's', config: { dataDir, docModel: 'sonnet' }, getJob, runClaude: fake('lo siento') }), { status: 502 });
});

test('cover letter includes notes and today', async () => {
  const dataDir = await setup();
  const rc = fake(letterJson);
  const r = await generateDocument({ kind: 'cover-letter', slug: 's', notes: 'Me encanta su producto', today: '2026-10-19', config: { dataDir, docModel: 'sonnet' }, getJob, runClaude: rc });
  assert.equal(r.file, 'cover-letter.pdf');
  assert.equal((await readFile(path.join(dataDir, 's', 'cover-letter.pdf'))).subarray(0, 5).toString(), '%PDF-');
  assert.ok(rc.calls[0].prompt.includes('Me encanta su producto'));
  assert.ok(rc.calls[0].prompt.includes('2026-10-19'));
});

test('prompts contain key rules', () => {
  const { systemPrompt } = buildCvPrompt({ cvBase: BASE, job });
  assert.ok(systemPrompt.includes('No inventes'));
  assert.match(systemPrompt, /nombres de empresas/i);
  const l = buildLetterPrompt({ cvBase: BASE, job, notes: '', today: '2026-10-19' });
  assert.ok(l.prompt.includes('(sin notas)'));
  assert.ok(l.systemPrompt.includes('250'));
});
