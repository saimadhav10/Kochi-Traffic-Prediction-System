import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { loadSettings, tomTomKey } from '../scripts/environment.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'kochi-env-'));
  t.after(() => {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('kochi-env-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('local overrides base configuration; process settings take precedence', t => {
  const directory = fixture(t);
  writeFileSync(join(directory, '.env'), 'TOMTOM_API_KEY=base\n');
  writeFileSync(join(directory, '.env.local'), 'TOMTOM_API_KEY=local\n');
  assert.equal(tomTomKey(loadSettings({ directory, environment: {} })), 'local');
  assert.equal(tomTomKey(loadSettings({ directory, environment: { TOMTOM_API_KEY: 'process' } })), 'process');
});

test('credential dollar signs are literal and do not interpolate environment values', t => {
  const directory = fixture(t);
  writeFileSync(join(directory, '.env'), 'TOMTOM_API_KEY="fake$literal${UNCHANGED}"\n');
  assert.equal(tomTomKey(loadSettings({ directory, environment: {} })), 'fake$literal${UNCHANGED}');
});

test('missing or placeholder key errors never echo other credentials', () => {
  for (const value of ['', 'replace_key', 'REMOVED_OLD_TOMTOM_KEY']) {
    assert.throws(() => tomTomKey({ TOMTOM_API_KEY: value, OTHER_SECRET: 'test-sensitive-value' }),
      error => error.message.includes('TOMTOM_API_KEY') && !error.message.includes('test-sensitive-value'));
  }
});

test('conflicting Wrangler secret files are detected instead of testing a different key', t => {
  const directory = fixture(t);
  writeFileSync(join(directory, '.env'), 'TOMTOM_API_KEY=first-test-key\n');
  writeFileSync(join(directory, '.dev.vars'), 'TOMTOM_API_KEY=second-test-key\n');
  assert.throws(() => loadSettings({ directory, environment: {} }), /conflicting/);
});
