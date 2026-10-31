import { handleApi, type Env } from './api.ts';
import { cleanQuotas } from './quota.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (env.QUOTA_DB) await cleanQuotas(env.QUOTA_DB);
  },
};
