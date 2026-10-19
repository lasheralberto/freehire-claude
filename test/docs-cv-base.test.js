import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveCvBase, readCvBase } from '../server/docs/cv-base.js';

const tmp = () => mkdtemp(join(tmpdir(), 'fh-'));

test('saveCvBase rejects non-PDF with 400', async () => {
  const dir = await tmp();
  await assert.rejects(saveCvBase(dir, Buffer.from('hello')), { status: 400 });
});

test('saveCvBase rejects empty text with 422 and writes nothing', async () => {
  const dir = await tmp();
  await assert.rejects(
    saveCvBase(dir, Buffer.from('%PDF-1.4 x'), { extract: async () => '' }),
    { status: 422 },
  );
  await assert.rejects(stat(join(dir, '_cv-base')), { code: 'ENOENT' });
});

test('saveCvBase writes both files and readCvBase returns text', async () => {
  const dir = await tmp();
  const text = 'Jane Doe\n' + 'x'.repeat(100);
  const r = await saveCvBase(dir, Buffer.from('%PDF-1.4 x'), { extract: async () => text });
  await stat(r.pdfPath);
  await stat(r.mdPath);
  assert.equal(r.chars, text.length);
  assert.equal(await readCvBase(dir), text);
});

test('readCvBase returns null when missing', async () => {
  assert.equal(await readCvBase(await tmp()), null);
});
