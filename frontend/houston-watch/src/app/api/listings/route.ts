import { errorResponse, lastDatasetItems, parseType } from '@/lib/apify';

/** GET /api/listings?type=sale|rent — items from the last successful run. */
export async function GET(request: Request) {
  const type = parseType(new URL(request.url).searchParams.get('type'));
  try {
    const items = await lastDatasetItems(type);
    return Response.json(items, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
