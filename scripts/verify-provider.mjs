import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, projectRoot, tomTomKey } from './environment.mjs';
import { runChecks } from './provider-checks.mjs';

try {
  const key = tomTomKey(loadSettings());
  console.log('Running up to 16 read-only TomTom requests. Keys and raw responses are not logged.');
  const checks = await runChecks(key);
  const passed = checks.length === 16 && checks.every(check => check.status === 'PASS');
  writeFileSync(join(projectRoot, 'provider-check.local.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), technicalChecksPassed: passed,
    accountAllowanceVerified: false, checks,
  }, null, 2) + '\n');
  for (const check of checks) console.log(`${check.status}: ${check.check}` +
    (check.reason ? ` [${check.reason}${check.httpStatus ? `, HTTP ${check.httpStatus}` : ''}]` : ''));
  console.log('Technical checks do not establish account plan limits or forecast accuracy.');
  if (!passed) process.exitCode = 1;
} catch {
  console.error('BLOCKED: set your own TOMTOM_API_KEY in .env and check the local configuration.');
  process.exitCode = 2;
}
