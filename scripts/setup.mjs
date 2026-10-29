import { copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadSettings, projectRoot, tomTomKey } from './environment.mjs';

try {
  execFileSync('git', ['check-ignore', '--no-index', '--quiet', '.env'], {
    cwd: projectRoot, stdio: 'pipe',
  });
  const path = join(projectRoot, '.env');
  if (!existsSync(path)) copyFileSync(join(projectRoot, '.env.example'), path);
  const settings = loadSettings();
  let configured = false;
  try { configured = Boolean(tomTomKey(settings)); } catch { /* No credential values in output. */ }
  console.log('Local .env: ready and ignored by Git.');
  console.log(`TomTom key: ${configured ? 'configured; verification needed' : 'not configured'}.`);
  console.log('Check Cloudflare access with: npm run cloudflare:status');
} catch {
  console.error('Setup failed: check file access, Git ignore rules, and use .env rather than .dev.vars.');
  process.exitCode = 1;
}
