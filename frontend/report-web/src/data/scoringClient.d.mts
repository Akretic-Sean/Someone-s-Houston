import type { BoundedScoringPayload } from '../../../../shared/scoring-estimates.mjs';
export function readBoundedJson(response: Response, maxBytes?: number): Promise<unknown>;
export function nextScoringDeadline(payload: BoundedScoringPayload, now?: number): number | null;
export function createScoringClient(options: { url: string; key: string; fetchImpl?: typeof fetch; now?: () => number }): {
  load(): Promise<BoundedScoringPayload>;
  nextRefreshAt(): number | null;
  invalidate(): void;
};
