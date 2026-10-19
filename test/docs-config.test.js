import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { loadConfig, saveConfig } from '../server/docs/config.js';
import { offerDir } from '../server/docs/paths.js';

const tmp = () => mkdtemp(join(tmpdir(), 'fh-'));

test('config: defaults, validation, merge', async () => {
  const dir = await tmp();
  const file = join(dir, 'config.json');
  assert.deepEqual(loadConfig(file), { dataDir: null, docModel: 'sonnet' });
  await assert.rejects(saveConfig(file, { dataDir: 'data' }), { status: 400 });
  const nested = join(dir, 'nested', 'dir');
  await saveConfig(file, { dataDir: nested });
  assert.equal(loadConfig(file).dataDir, nested);
  await saveConfig(file, { docModel: 'opus' });
  assert.deepEqual(loadConfig(file), { dataDir: nested, docModel: 'opus' });
  await assert.rejects(saveConfig(file, { docModel: 'gpt' }), { status: 400 });
  await assert.rejects(saveConfig(file, { dataDir: file }), { status: 400 });
});

test('offerDir sanitizes and stays inside dataDir', async () => {
  const root = await tmp();
  assert.equal(offerDir(root, 'senior-dev-acme_123'), join(root, 'senior-dev-acme_123'));
  assert.ok(offerDir(root, '../evil').startsWith(root + sep));
  assert.equal(offerDir(root, 'a/b'), join(root, 'a_b'));
  assert.throws(() => offerDir(root, '..'), { status: 400 });
  assert.throws(() => offerDir(root, ''), { status: 400 });
});
