import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { renderCvPdf, renderLetterPdf } from '../server/docs/render.js';
import { extractPdfText } from '../server/docs/cv-base.js';
import { validateCv, validateLetter } from '../server/docs/schema.js';

const cv = validateCv({
  language: 'en',
  name: 'Zoë Müller',
  headline: 'Senior Engineer',
  contact: { email: 'zoe@example.com', phone: '+34 600 000 000', location: 'Madrid', links: ['https://example.com/zoe'] },
  headings: { summary: 'Summary', experience: 'Professional Experience', education: 'Education', skills: 'Skills', certifications: 'Certifications', languages: 'Languages' },
  summary: 'Engineer with a long history of shipping things.',
  skills: ['Node.js', 'SQL', 'SAP'],
  experience: [{ title: 'Lead', company: 'Ørsted', location: 'Łódź', start: '2020', end: 'Present', bullets: ['Built things', 'Led a team'] }],
  education: [{ degree: 'MSc', institution: 'Boğaziçi Üniversitesi, İstanbul', start: '2010', end: '2014' }],
  certifications: ['CISA'],
  languages: ['English', 'Spanish'],
});

const letter = validateLetter({
  language: 'en', name: 'Zoë Müller',
  contact: { email: 'zoe@example.com', phone: '', location: 'Madrid', links: [] },
  date: '19 October 2026', recipient: 'Hiring Team, Ørsted', greeting: 'Dear team,',
  paragraphs: [
    'I am writing to apply for the engineer role at your company because it matches my background.',
    'In my previous position I delivered several projects on time and under budget for clients.',
  ],
  closing: 'Kind regards,', signature: 'Zoë Müller',
});

test('renderCvPdf produces ATS-readable Unicode text', async () => {
  const buf = await renderCvPdf(cv);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const text = await extractPdfText(buf);
  for (const s of ['Zoë Müller', 'Ørsted', 'Łódź', 'İstanbul', 'Professional Experience']) {
    assert.ok(text.includes(s), `missing ${s}`);
  }
  await writeFile(process.env.FH_RENDER_OUT || 'NUL', buf).catch(() => {});
});

test('renderLetterPdf contains every paragraph', async () => {
  const buf = await renderLetterPdf(letter);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const text = (await extractPdfText(buf)).replace(/\s+/g, ' ');
  for (const p of letter.paragraphs) assert.ok(text.includes(p.slice(0, 20)), p.slice(0, 20));
});
