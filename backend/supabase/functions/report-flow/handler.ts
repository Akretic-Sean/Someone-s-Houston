import { z } from "zod";
import {
  createReportModelClient,
  ExtractionInput,
  FormSchema,
} from "../_shared/report-models/mod.ts";
// @deno-types="../../../../shared/scoring.d.mts"
import {
  CATEGORY_IDS,
  scoreNeighborhoods,
  validateScoringPayload,
} from "../../../../shared/scoring.mjs";
import type {
  ScoringOptions,
  ScoringPayload,
  ScoringResult,
} from "../../../../shared/scoring.d.mts";

const weight = z.number().int().min(0).max(10);
const Options = z.object({
  tenure: z.enum(["rent", "buy"]),
  mode: z.enum(["offer", "remote"]),
  office: z.enum(["ion", "downtown", "energy", "tmc", "nasa"]),
  airport: z.enum(["nearest", "iah", "hou"]),
  weights: z.object({
    afford: weight,
    commute: weight,
    flood: weight,
    amen: weight,
    fit: weight,
    food: weight,
    air: weight,
    health: weight,
  }).strict(),
}).strict().refine((value) =>
  CATEGORY_IDS.some((id) =>
    (id !== "commute" || value.mode !== "remote") && value.weights[id] > 0
  )
);
const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extract"),
    requestId: z.string().uuid(),
    input: ExtractionInput,
  }).strict(),
  z.object({
    action: z.literal("generate"),
    requestId: z.string().uuid(),
    options: Options,
    preferences: FormSchema,
  }).strict(),
]);
type Models = Pick<
  ReturnType<typeof createReportModelClient>,
  "extract" | "narrate"
>;
export type Dependencies = {
  authenticate: (token: string) => Promise<string | null>;
  reserve: (
    userId: string,
    requestId: string,
  ) => Promise<"allowed" | "duplicate" | "limited">;
  loadScoring: (token: string) => Promise<unknown>;
  models: () => Models;
  now?: () => number;
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      ...(status === 429 ? { "Retry-After": "3600" } : {}),
    },
  });

// Bound bytes while streaming; Content-Length is not trusted. Never log bodies.
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 100_000) {
      await reader.cancel();
      throw new Error("size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function reportFacts(
  payload: ScoringPayload,
  result: ScoringResult,
  options: ScoringOptions,
  now: number,
) {
  // Every ranked score depends on the comparison cohort, not just the winners.
  const expiries = payload.neighborhoods.flatMap((row) =>
    CATEGORY_IDS.flatMap((id) => {
      const category = row.categories[id];
      return result.effectiveWeights[id] > 0 &&
          ["partial", "reference_snapshot"].includes(category.availability) &&
          category.refresh_due_at && Date.parse(category.refresh_due_at) > now
        ? [Date.parse(category.refresh_due_at)]
        : [];
    })
  );
  const expiresAt = new Date(Math.min(now + 3_600_000, ...expiries))
    .toISOString();
  const facts = result.ranked.slice(0, 3).flatMap((row) => {
    const source =
      `Published neighborhood evidence and your selected weights; provisional comparison calculated ${result.evaluatedAt}. Original sources and periods are shown in the neighborhood evidence.`;
    const base = { source, refresh_due_at: expiresAt };
    return [
      {
        ...base,
        id: `match_${row.neighborhoodId}`,
        label: "Computed relative match; not an independent rating",
        value:
          `${row.name}: rank ${row.rank} among ${result.ranked.length} comparable neighborhoods, score ${
            row.totalScore!.toFixed(1)
          } / 100`,
      },
      ...CATEGORY_IDS.filter((id) => row.categories[id].weight > 0).sort((
        a,
        b,
      ) =>
        (row.categories[b].contribution ?? 0) -
        (row.categories[a].contribution ?? 0)
      ).slice(0, 2).map((id) => ({
        ...base,
        id: `factor_${row.neighborhoodId}_${id}`,
        label: `${row.name}: ${row.categories[id].label}`,
        value: `${row.categories[id].measurement}. Category score ${
          row.categories[id].score!.toFixed(1)
        } / 100; selected weight ${
          (row.categories[id].normalizedWeight * 100).toFixed(1)
        }%.`,
      })),
    ];
  });
  // Explicit choices, not model-inferred neighborhood preferences, control ranking.
  return {
    facts,
    expiresAt,
    section:
      `Explain the computed ${options.tenure} neighborhood comparison without changing its order`,
  };
}

export function createHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return reply(405, { error: "method_not_allowed" });
    }
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)
      ?.[1];
    if (!token) return reply(401, { error: "sign_in_required" });
    try {
      const userId = await deps.authenticate(token);
      if (!userId) return reply(401, { error: "sign_in_required" });
      if (
        !request.headers.get("Content-Type")?.toLowerCase().startsWith(
          "application/json",
        )
      ) return reply(415, { error: "json_required" });
      let input: z.infer<typeof RequestSchema>;
      try {
        input = RequestSchema.parse(await readBody(request));
      } catch {
        return reply(400, { error: "invalid_input" });
      }
      // Load and validate authoritative evidence before charging a report attempt.
      let payload: ScoringPayload | undefined;
      let result: ScoringResult | undefined;
      const now = deps.now ?? Date.now;
      if (input.action === "generate") {
        try {
          payload = validateScoringPayload(await deps.loadScoring(token));
          result = scoreNeighborhoods(payload, input.options, now());
        } catch {
          return reply(503, { error: "evidence_unavailable" });
        }
        if (!result.ranked.length) {
          return reply(422, { error: "no_comparable_neighborhoods" });
        }
      }
      const reservation = await deps.reserve(userId, input.requestId);
      if (reservation === "duplicate") {
        return reply(409, { error: "request_already_started" });
      }
      if (reservation !== "allowed") {
        return reply(429, { error: "usage_limit" });
      }
      const models = deps.models();
      if (input.action === "extract") {
        return reply(200, await models.extract(input.input));
      }
      const bundle = reportFacts(payload!, result!, input.options, now());
      const narration = await models.narrate({
        section: bundle.section,
        facts: bundle.facts,
        preferences: input.preferences,
      });
      if (Date.parse(bundle.expiresAt) <= now()) {
        return reply(409, { error: "evidence_expired" });
      }
      const byId = new Map(bundle.facts.map((fact) => [fact.id, fact.value]));
      const text = narration.data?.prose.replace(
        /\[fact:([a-z][a-z0-9_.-]*)\]/g,
        (_match, id: string) => byId.get(id) ?? "",
      ) ?? null;
      return reply(200, {
        payload,
        generatedAt: new Date(now()).toISOString(),
        narrative: {
          status: narration.status,
          ...(narration.status === "degraded"
            ? { reason: narration.reason, diagnostic: narration.diagnostic }
            : {}),
          text,
          expiresAt: bundle.expiresAt,
          facts: narration.data
            ? bundle.facts.filter((fact) =>
              narration.data!.facts_used.includes(fact.id)
            )
            : [],
        },
      });
    } catch {
      // Auth/quota infrastructure failures fail closed; never expose private SDK errors.
      return reply(503, { error: "temporarily_unavailable" });
    }
  };
}
