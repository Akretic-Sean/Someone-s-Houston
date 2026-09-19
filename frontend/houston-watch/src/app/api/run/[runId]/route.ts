import { errorResponse, runStatus } from '@/lib/apify';

/** GET /api/run/[runId] — status, so the UI can poll until SUCCEEDED. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  try {
    return Response.json(await runStatus(runId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
