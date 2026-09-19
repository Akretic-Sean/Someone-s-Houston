import { errorResponse, parseType, startRun } from '@/lib/apify';

/**
 * POST /api/run?type=sale|rent — starts a run and returns its id and status.
 * Billable: the underlying actor charges per dataset item.
 */
export async function POST(request: Request) {
  const type = parseType(new URL(request.url).searchParams.get('type'));
  try {
    const run = await startRun(type);
    return Response.json(run, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
