import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCv, validateLetter } from '../server/docs/schema.js';
import { checkCvFacts } from '../server/docs/fact-check.js';

test('validateCv fills defaults', () => {
  const cv = validateCv({ name: 'A', headings: {}, experience: [] });
  assert.deepEqual(cv.skills, []);
  assert.deepEqual(cv.contact.links, []);
  assert.equal(cv.headings.summary, '');
  assert.equal(cv.summary, '');
});

test('validateCv rejects invalid input', () => {
  assert.throws(() => validateCv({}));
  assert.throws(() => validateCv({ name: 'A', experience: [] }));
  assert.throws(() => validateCv({ name: 'A', headings: {}, experience: 'x' }));
});

test('validateLetter', () => {
  assert.throws(() => validateLetter({ name: 'A', paragraphs: [] }));
  assert.throws(() => validateLetter({ name: '', paragraphs: ['x'] }));
  const l = validateLetter({ name: 'A', paragraphs: ['hola'] });
  assert.deepEqual(l.contact.links, []);
  assert.equal(l.greeting, '');
});

const BASE = 'Ingeniero en Telefónica 2019 - 2023, Universidad Politécnica de Madrid';
const cvWith = (exp, extra = {}) =>
  validateCv({ name: 'A', headings: {}, experience: [exp], ...extra });

test('checkCvFacts', () => {
  assert.deepEqual(checkCvFacts(cvWith({ company: 'Telefonica', start: '2019', end: '2023' }), BASE), []);
  const g = checkCvFacts(cvWith({ company: 'Google' }), BASE);
  assert.equal(g.length, 1);
  assert.match(g[0], /Google/);
  const y = checkCvFacts(cvWith({ company: 'Telefonica', end: '2024' }), BASE);
  assert.equal(y.length, 1);
  assert.match(y[0], /2024/);
  assert.deepEqual(checkCvFacts(cvWith({ company: 'Telefonica', end: 'Present' }), BASE), []);
});
