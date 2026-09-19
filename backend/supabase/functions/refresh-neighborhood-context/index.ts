import { createRefreshHandler } from '../../../dist/refresh-current-context.js';
import { REFRESH_TOKEN_SHA256 } from './auth-config.ts';

// Supabase injects these server credentials. Never copy them into frontend code.
// https://supabase.com/docs/guides/functions/secrets#default-secrets
function serverKey(): string {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try {
      const key = JSON.parse(modern).default;
      if (typeof key === 'string' && key.startsWith('sb_secret_')) return key;
    } catch { /* A legacy service-role key may still be available below. */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

let handler: (request: Request) => Promise<Response>;
try {
  handler = createRefreshHandler({
    tokenSha256: REFRESH_TOKEN_SHA256,
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey: serverKey(),
  });
} catch {
  handler = async () => new Response(JSON.stringify({ error: 'Refresh service is not configured.' }), {
    status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// Gateway verify_jwt=false is deliberate: the fixed-purpose handler checks its own
// high-entropy x-refresh-token before making any provider or database requests.
Deno.serve(handler);
