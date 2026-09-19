import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CATEGORY_IDS, scoreNeighborhoods, validateScoringPayload, type ScoringPayload, type ScoringResult } from '../../shared/scoring.mjs';
import { readBoundedJson, supabaseBaseUrl } from './neighborhoods.js';

const weight = z.number().min(0).max(10);
export const scoringOptionsSchema = z.object({
  weights: z.object({ afford: weight, commute: weight, flood: weight, amen: weight, fit: weight, food: weight, air: weight, health: weight }).strict(),
  tenure: z.enum(['rent', 'buy']), mode: z.enum(['offer', 'remote']),
  office: z.enum(['ion', 'downtown', 'energy', 'tmc', 'nasa']), airport: z.enum(['iah', 'hou', 'nearest']),
}).strict().refine(o => CATEGORY_IDS.some(id => (o.mode !== 'remote' || id !== 'commute') && o.weights[id] > 0), 'Choose a positive effective priority');
export const comparisonInputSchema = z.object({
  baseline: scoringOptionsSchema, alternative: scoringOptionsSchema, limit: z.number().int().min(1).max(5).default(3),
}).strict();

function summarize(result: ScoringResult, limit: number) {
  const [winner, runner] = result.ranked;
  return {
    effective_weights: result.effectiveWeights, normalized_weights: result.normalizedWeights,
    ranked_count: result.ranked.length, shortlist: result.ranked.slice(0, limit),
    excluded: result.unranked.map(r => ({ neighborhood_id: r.neighborhoodId, name: r.name,
      reasons: r.missingCategories.map(id => ({ category: id, reason: r.categories[id].reason })) })),
    winner_margin: winner && runner ? {
      winner_id: winner.neighborhoodId, runner_up_id: runner.neighborhoodId,
      total_points: winner.totalScore! - runner.totalScore!,
      // These signed contributions sum to the margin. Negative values favor the runner-up.
      categories: CATEGORY_IDS.map(id => ({ category: id,
        points: result.effectiveWeights[id] === 0 ? 0 : winner.categories[id].contribution! - runner.categories[id].contribution!,
        measurement: winner.categories[id].measurement,
      })),
    } : null,
  };
}

export function compareScenarios(payload: ScoringPayload, input: unknown, now = Date.now()) {
  const args = comparisonInputSchema.parse(input);
  const baseline = scoreNeighborhoods(payload, args.baseline, now);
  const alternative = scoreNeighborhoods(payload, args.alternative, now);
  const { evaluated_at: _time, ...snapshot } = payload;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  return {
    schema_version: 1, model_version: baseline.modelVersion, evaluated_at: baseline.evaluatedAt,
    snapshot_sha256: createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex'),
    evidence_versions: [...new Set(payload.neighborhoods.flatMap(r => CATEGORY_IDS.map(id => r.categories[id].evidence_version)).filter(v => v !== null))],
    preferences: args, baseline: summarize(baseline, args.limit), alternative: summarize(alternative, args.limit),
    rank_changes: baseline.results.map(before => {
      const after = alternative.results.find(r => r.neighborhoodId === before.neighborhoodId)!;
      return { neighborhood_id: before.neighborhoodId, name: before.name, baseline_rank: before.rank, alternative_rank: after.rank,
        rank_improvement: before.rank === null || after.rank === null ? null : before.rank - after.rank };
    }),
    interpretation: 'Deterministic comparison of explicit preferences on the same 88-neighborhood snapshot. Relative scores are not probabilities or causal predictions. Rank movement can reflect changed eligibility; null ranks are unranked, not last place. Distances are not travel times. Crime, schools and transit supplements do not affect scoring. Read get_neighborhood_evidence for source links before presenting claims.',
  };
}

export function createComparisonClient(options: { url: string; publishableKey: string; fetch?: typeof fetch; now?: () => number; cacheMs?: number }) {
  const base = supabaseBaseUrl(options.url), fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey)) throw new Error('A public publishable key is required');
  const ttl = options.cacheMs ?? 3_600_000;
  if (!Number.isFinite(ttl) || ttl < 0 || ttl > 3_600_000) throw new Error('Cache must be 0-1 hour');
  let data: ScoringPayload | undefined, expires = 0, inflight: Promise<void> | undefined;
  return {
    async compare(input: unknown) {
      const args = comparisonInputSchema.parse(input);
      if (!data || now() >= expires) {
        if (!inflight) inflight = (async () => {
          const response = await fetcher(`${base}/rest/v1/rpc/get_neighborhood_scoring_data`, {
            method: 'POST', headers: { apikey: options.publishableKey, 'Content-Type': 'application/json' }, body: '{}',
            signal: AbortSignal.timeout(15_000), redirect: 'error',
          });
          const parsed = validateScoringPayload(await readBoundedJson(response, 250_000));
          if (Date.parse(parsed.evaluated_at) > now() + 300_000) throw new Error('Future scoring snapshot');
          const deadlines = parsed.neighborhoods.flatMap(r => CATEGORY_IDS.map(id => r.categories[id]))
            .filter(c => ['partial', 'reference_snapshot'].includes(c.availability)).map(c => Date.parse(c.refresh_due_at!));
          data = parsed; expires = Math.min(now() + ttl, ...deadlines);
        })().finally(() => { inflight = undefined; });
        await inflight;
      }
      return compareScenarios(data!, args, now());
    },
  };
}
export type ComparisonClient = ReturnType<typeof createComparisonClient>;
