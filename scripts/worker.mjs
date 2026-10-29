import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot } from './environment.mjs';

const child = spawn(process.execPath, [join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'),
  'dev', '--ip', '127.0.0.1', '--port', '8787', '--log-level', 'warn'], {
  cwd: projectRoot, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'inherit',
});
child.on('error', () => { console.error('Could not start local preview. Install dependencies and build first.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
