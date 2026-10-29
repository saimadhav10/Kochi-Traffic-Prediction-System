import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot } from './environment.mjs';

const action = process.argv[2];
if (!['login', 'whoami'].includes(action)) {
  console.error('Supported Cloudflare actions: login, whoami.');
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'), action], {
    cwd: projectRoot,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: 'inherit',
  });
  child.on('error', () => { console.error('Could not start Wrangler. Run npm install first.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
