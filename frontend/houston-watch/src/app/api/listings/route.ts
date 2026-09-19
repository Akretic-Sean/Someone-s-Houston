import { errorResponse, lastDatasetItems, parseType } from '@/lib/apify';
import { corsHeaders, preflight } from '@/lib/cors';

/*
 * The route itself must not be cached. Its response varies by Origin, and Next's
 * route cache served the first variant — produced by a same-origin request with
 * no Origin header, hence no CORS header — to cross-origin callers too. The
 * five-minute cache still applies, but to the upstream Apify fetch where it
 * belongs.
 */
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: Request) {
  return preflight(request);
}

/** GET /api/listings?type=sale|rent — items from the last successful run. */
export async function GET(request: Request) {
  const type = parseType(new URL(request.url).searchParams.get('type'));
  const cors = corsHeaders(request);
  try {
    const items = await lastDatasetItems(type);
    return Response.json(items, {
      headers: {
        ...cors,
        /*
         * Not `public`: this response varies by Origin, and a shared browser
         * cache entry stored for a same-origin request (no CORS header) is
         * replayed for cross-origin ones, which then fail CORS. The five-minute
         * cache the brief asks for lives on the upstream Apify fetch instead,
         * so Apify is still hit at most once per five minutes.
         */
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  }
}
