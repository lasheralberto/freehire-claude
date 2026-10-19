import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownFilter } from '../mcp/src/vocab.js';
import { parseJsonObject } from '../mcp/src/sampling.js';
import { samplingMessagesToPrompt, pickModel } from '../mcp/src/claude-cli.js';
import { compactJob, stripHtml } from '../mcp/src/freehire-api.js';
import { sanitizeAttempt } from '../mcp/src/agentic.js';

test('isKnownFilter accepts facets, scalars and modifiers only', () => {
  for (const k of ['skills', 'countries', 'salary_min', 'skills_mode', 'company_type_exclude']) assert.ok(isKnownFilter(k), k);
  for (const k of ['skill', 'location', 'remote', 'foo_mode']) assert.ok(!isKnownFilter(k), k);
});

test('parseJsonObject handles fences and surrounding prose', () => {
  assert.deepEqual(parseJsonObject('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('sure {"a":{"b":2}} done'), { a: { b: 2 } });
  assert.throws(() => parseJsonObject('no json here'));
});

test('sanitizeAttempt drops unknown filters and joins arrays', () => {
  const { params, dropped } = sanitizeAttempt({
    q: 'go',
    q_fields: 'description',
    sort: 'nope',
    filters: { skills: ['go', 'rust'], location: 'Madrid', visa_sponsorship: true, seniority: '' },
  });
  assert.deepEqual(params, { q: 'go', skills: 'go,rust', visa_sponsorship: 'true' });
  assert.deepEqual(dropped, ['location']);
});

test('samplingMessagesToPrompt flattens multi-turn conversations', () => {
  assert.equal(samplingMessagesToPrompt([{ role: 'user', content: { type: 'text', text: 'hi' } }]), 'hi');
  const multi = samplingMessagesToPrompt([
    { role: 'user', content: { type: 'text', text: 'a' } },
    { role: 'assistant', content: { type: 'text', text: 'b' } },
  ]);
  assert.match(multi, /<user>\na\n<\/user>/);
  assert.match(multi, /<assistant>\nb\n<\/assistant>/);
});

test('pickModel maps MCP hints to CLI aliases', () => {
  assert.equal(pickModel({ hints: [{ name: 'claude-3-5-sonnet' }] }), 'sonnet');
  assert.equal(pickModel({ hints: [{ name: 'gpt-4' }, { name: 'opus' }] }), 'opus');
});

test('compactJob keeps the essentials and strips HTML', () => {
  const job = compactJob({
    public_slug: 'x-1',
    title: 'Senior Go Engineer',
    company: 'Acme',
    description: '<p>Build <b>things</b></p>',
    skills: ['go'],
    enrichment: { seniority: 'senior', salary_min: 90000, salary_currency: 'EUR', salary_period: 'year' },
    reality: { class: 'fresh' },
  });
  assert.equal(job.slug, 'x-1');
  assert.equal(job.seniority, 'senior');
  assert.deepEqual(job.salary, { min: 90000, max: null, currency: 'EUR', period: 'year' });
  assert.equal(job.summary, 'Build things');
  assert.equal(stripHtml('<li>a</li><li>b</li>'), '• a\n• b');
});
