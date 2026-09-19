import type { ScoringPayload } from '../../../../shared/scoring.mjs';
export function readBoundedJson(response: Response, maxBytes?: number): Promise<unknown>;
export function nextScoringDeadline(payload: ScoringPayload, now?: number): number | null;
export function createScoringClient(options: { url: string; key: string; fetchImpl?: typeof fetch; now?: () => number }): {
  load(): Promise<ScoringPayload>;
  nextRefreshAt(): number | null;
  invalidate(): void;
};
