import 'server-only';

/**
 * Apify access. Server-side only — `server-only` makes importing this from a
 * client component a build error, so the token cannot reach the browser.
 */

const BASE = 'https://api.apify.com/v2';
const TASK_OWNER = 'gnomonic_validation';

export type ListingType = 'sale' | 'rent';

export function parseType(value: string | null): ListingType {
  return value === 'rent' ? 'rent' : 'sale';
}

export function taskId(type: ListingType): string {
  return `${TASK_OWNER}~houston-watch-${type}`;
}

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** `no_run` is the expected state before a task has ever succeeded. */
    readonly kind: 'no_token' | 'unauthorized' | 'no_run' | 'upstream',
  ) {
    super(message);
    this.name = 'ApifyError';
  }
}

function token(): string {
  const value = process.env.APIFY_TOKEN?.trim();
  if (!value) {
    throw new ApifyError(
      'APIFY_TOKEN is not set. Copy .env.local.example to .env.local and add the token.',
      500,
      'no_token',
    );
  }
  return value;
}

async function call(path: string, init?: RequestInit & { next?: { revalidate: number } }) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init?.headers ?? {}) },
  });

  if (response.status === 401 || response.status === 403) {
    throw new ApifyError('Apify rejected the token.', 502, 'unauthorized');
  }
  if (response.status === 404) {
    throw new ApifyError(
      'Apify has no matching record. The task has probably never completed a run.',
      404,
      'no_run',
    );
  }
  if (!response.ok) {
    throw new ApifyError(`Apify returned HTTP ${response.status}.`, 502, 'upstream');
  }
  return response;
}

/** Items from the task's last successful run. */
export async function lastDatasetItems(type: ListingType): Promise<unknown[]> {
  const response = await call(
    `/actor-tasks/${taskId(type)}/runs/last/dataset/items?status=SUCCEEDED`,
    // Cached five minutes, per the brief.
    { next: { revalidate: 300 } },
  );
  const json = await response.json();
  return Array.isArray(json) ? json : [];
}

export interface RunSummary {
  id: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  defaultDatasetId?: string | null;
}

/** Starts a run. Billable: the actor charges per dataset item. */
export async function startRun(type: ListingType): Promise<RunSummary> {
  const response = await call(`/actor-tasks/${taskId(type)}/runs`, {
    method: 'POST',
    cache: 'no-store',
  });
  const { data } = await response.json();
  return {
    id: data.id,
    status: data.status,
    startedAt: data.startedAt ?? null,
    finishedAt: data.finishedAt ?? null,
    defaultDatasetId: data.defaultDatasetId ?? null,
  };
}

export async function runStatus(runId: string): Promise<RunSummary> {
  const response = await call(`/actor-runs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
  const { data } = await response.json();
  return {
    id: data.id,
    status: data.status,
    startedAt: data.startedAt ?? null,
    finishedAt: data.finishedAt ?? null,
    defaultDatasetId: data.defaultDatasetId ?? null,
  };
}

export function errorResponse(error: unknown) {
  if (error instanceof ApifyError) {
    return Response.json(
      { error: { kind: error.kind, message: error.message } },
      { status: error.status },
    );
  }
  return Response.json(
    { error: { kind: 'upstream', message: 'Unexpected failure talking to Apify.' } },
    { status: 502 },
  );
}
