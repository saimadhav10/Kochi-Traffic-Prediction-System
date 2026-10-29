import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function loadSettings({ directory = projectRoot, environment = process.env } = {}) {
  if (existsSync(join(directory, '.dev.vars'))) {
    throw new Error('Use .env for this project; remove the conflicting .dev.vars configuration.');
  }
  const settings = {};
  for (const name of ['.env', '.env.local']) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    try {
      Object.assign(settings, parseEnv(readFileSync(path, 'utf8')));
    } catch {
      throw new Error('Could not read local environment configuration.');
    }
  }
  return { ...settings, ...environment };
}

export function tomTomKey(settings) {
  const key = settings.TOMTOM_API_KEY?.trim();
  if (!key || /^(replace_|paste_|your_|REMOVED_)/i.test(key)) {
    throw new Error('Set your own TOMTOM_API_KEY in the ignored .env file.');
  }
  return key;
}
