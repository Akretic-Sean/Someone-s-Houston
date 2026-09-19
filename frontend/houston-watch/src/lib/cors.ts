import 'server-only';

/**
 * The Someone's Houston report is a separate static app on another origin, so
 * the read routes it consumes need CORS. Origins are allow-listed from
 * ALLOWED_ORIGINS rather than opened to `*`, because these routes are the only
 * thing standing between the browser and a token-bearing upstream.
 */
function allowed(): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.trim();
  if (configured) return configured.split(',').map((o) => o.trim()).filter(Boolean);
  // Dev default: the report app's Vite server.
  return ['http://localhost:5199', 'http://127.0.0.1:5199'];
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !allowed().includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

export function preflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '600',
    },
  });
}
