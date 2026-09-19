import type { ScoringPayload } from "../../../../shared/scoring.d.mts";
import { createHandler, type Dependencies } from "./handler.ts";
import { formOnly, NarrationInput } from "../_shared/report-models/mod.ts";
// @deno-types="../../../../shared/scoring.d.mts"
import {
  CATEGORY_IDS,
  DEFAULT_WEIGHTS,
  MODEL_VERSION,
} from "../../../../shared/scoring.mjs";
// @deno-types="../../../../shared/scoring-estimates.d.mts"
import { scoreNeighborhoodsWithEstimates } from "../../../../shared/scoring-estimates.mjs";
import type { ScoringOptions } from "../../../../shared/scoring.d.mts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const time = Date.parse("2026-09-19T22:00:00Z");
function fixture() {
  return {
    schema_version: 1,
    model_version: MODEL_VERSION,
    evaluated_at: new Date(time).toISOString(),
    category_definitions: CATEGORY_IDS.map((id) => ({
      id,
      label: id,
      default_weight: DEFAULT_WEIGHTS[id],
    })),
    neighborhoods: Array.from({ length: 88 }, (_, index) => {
      const n = index + 1;
      const metrics = {
        afford: { rent_usd: 1000 + n, home_value_usd: 400000 + n },
        commute: { ion: n, downtown: n, energy: n, tmc: n, nasa: n },
        flood: { sfha_area_pct: n / 2 },
        amen: {
          libraries: n,
          museums: n,
          community_centers: n,
          multi_service_centers: n,
        },
        fit: { parks: n, community_centers: n },
        food: { grocery_stores: n },
        air: { iah: n, hou: n },
        health: {
          hospitals: n,
          health_facilities: n,
          multi_service_centers: n,
        },
      };
      return {
        neighborhood_id: n,
        name: `Neighborhood ${n}`,
        reference_point: { latitude: 29.75, longitude: -95.37 },
        categories: Object.fromEntries(
          CATEGORY_IDS.map(
            (id) => [id, {
              availability: "partial",
              evidence_version: "test",
              refresh_due_at: new Date(time + 3_600_000).toISOString(),
              metrics: metrics[id],
            }],
          ),
        ),
      };
    }),
  };
}
const requestId = "390cc8f3-1b14-4c3b-a094-608dcd77d3e5";
const generate = {
  action: "generate",
  requestId,
  options: {
    weights: DEFAULT_WEIGHTS,
    tenure: "rent",
    mode: "offer",
    office: "ion",
    airport: "nearest",
  },
  preferences: {},
};
function setup(overrides: Partial<Dependencies> = {}) {
  const calls = { model: 0, reserved: 0, loaded: 0 };
  const deps: Dependencies = {
    authenticate: async (token) =>
      token === "valid-user-token" ? "verified-user" : null,
    reserve: async (user, id) => {
      assert(user === "verified-user");
      assert(id === requestId);
      calls.reserved++;
      return "allowed";
    },
    loadScoring: async () => {
      calls.loaded++;
      return fixture();
    },
    now: () => time,
    models: () => ({
      extract: async () => {
        calls.model++;
        return { status: "generated", data: formOnly({ office: "Midtown" }) };
      },
      narrate: async (raw) => {
        calls.model++;
        const input = NarrationInput.parse(raw);
        assert(
          input.facts[0].value.includes("Neighborhood 1"),
          "Ranking must come from the server snapshot",
        );
        return {
          status: "generated",
          data: {
            prose: `Consider [fact:${input.facts[0].id}].`,
            facts_used: [input.facts[0].id],
            preferences_used: [],
          },
        };
      },
    }),
    ...overrides,
  };
  const handler = createHandler(deps);
  const send = (body: unknown = generate, token = "valid-user-token") =>
    handler(
      new Request("https://example.test/report-flow", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  return { handler, send, calls };
}
Deno.test("auth rejects unverified callers before any paid work or evidence read", async () => {
  const { send, calls } = setup();
  assert((await send(generate, "forged-token")).status === 401);
  assert(calls.model === 0 && calls.loaded === 0 && calls.reserved === 0);
});
Deno.test("CORS preflight needs no session; other methods cannot trigger AI", async () => {
  const { handler, calls } = setup();
  const response = await handler(
    new Request("https://example.test", { method: "OPTIONS" }),
  );
  assert(
    response.status === 204 &&
      response.headers.get("access-control-allow-origin") === "*",
  );
  assert((await handler(new Request("https://example.test"))).status === 405);
  assert(calls.model === 0);
});
Deno.test("strict body validation rejects forged facts, identities, oversized notes and empty weights", async () => {
  const { send, calls } = setup();
  for (
    const body of [{ ...generate, facts: [{ score: 100 }] }, {
      ...generate,
      userId: "another-user",
    }, {
      action: "extract",
      requestId,
      input: { transcript: "x".repeat(100_001), answers: {} },
    }, {
      ...generate,
      options: {
        ...generate.options,
        weights: Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])),
      },
    }]
  ) {
    assert((await send(body)).status === 400);
  }
  assert(calls.reserved === 0 && calls.model === 0);
});
Deno.test("duplicate requests and exhausted quotas cannot call models", async () => {
  for (
    const [result, status] of [["duplicate", 409], ["limited", 429]] as const
  ) {
    const { send, calls } = setup({ reserve: async () => result });
    assert((await send()).status === status);
    assert(calls.model === 0);
  }
});
Deno.test("quota infrastructure fails closed with bounded errors", async () => {
  const { send, calls } = setup({
    reserve: async () => {
      throw new Error("private credential data");
    },
  });
  const response = await send();
  assert(response.status === 503);
  assert(!(await response.text()).includes("credential"));
  assert(calls.model === 0);
});
Deno.test("server evidence determines ranking and fact substitution; plain text response", async () => {
  const { send, calls } = setup();
  const response = await send();
  const body = await response.json();
  assert(response.status === 200);
  assert(body.narrative.text.includes("Neighborhood 1: rank 1"));
  assert(!body.narrative.text.includes("[fact:"));
  assert(body.payload.neighborhoods.length === 88);
  assert(body.narrative.facts.length === 1);
  assert(response.headers.get("cache-control") === "no-store");
  assert(calls.model === 1);
});
Deno.test("model degradation preserves the factual report", async () => {
  const { send } = setup({
    models: () => ({
      extract: async () => ({
        status: "degraded",
        data: formOnly({}),
        reason: "unconfigured",
      }),
      narrate: async () => ({
        status: "degraded",
        data: null,
        reason: "unconfigured",
      }),
    }),
  });
  const response = await send();
  const body = await response.json();
  assert(
    response.status === 200 && body.narrative.status === "degraded" &&
      body.narrative.text === null,
  );
  assert(body.payload.neighborhoods.length === 88);
});
Deno.test("expired or malformed evidence cannot reach the model", async () => {
  const { send, calls } = setup({ now: () => time + 3_600_001 });
  assert((await send()).status === 503);
  assert(calls.model === 0 && calls.reserved === 0);
});
Deno.test("evidence expiring during narration is rejected", async () => {
  let reads = 0;
  const { send } = setup({ now: () => ++reads > 2 ? time + 3_600_001 : time });
  assert((await send()).status === 409);
});
Deno.test("extraction authenticates and reserves usage without reading public scoring", async () => {
  const { send, calls } = setup();
  const response = await send({
    action: "extract",
    requestId,
    input: { transcript: "Work near Midtown", answers: {} },
  });
  assert(response.status === 200);
  assert((await response.json()).data.fields.office.value === "Midtown");
  assert(calls.reserved === 1 && calls.model === 1 && calls.loaded === 0);
});

function boundedFixture() {
  const base = fixture();
  const estimates = [7, 17, 25, 41, 43, 80].map((id) => {
    const rent = id === 7;
    const category = rent ? "afford" : "flood";
    const metric = rent ? "rent_usd" : "sfha_area_pct";
    (base.neighborhoods[id - 1].categories[category].metrics as Record<string, number | null>)[metric] = null;
    return {
      neighborhood_id: id,
      category_id: category,
      metric,
      lower_bound: rent ? 1500 : 10,
      upper_bound: rent ? 1999 : 11,
      ranking_value: rent ? 1999 : 11,
      method: "conservative_upper_bound",
      source_url: rent
        ? "https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/6-Gross-Rent-2024.pdf"
        : "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
      source_period: "Synthetic test",
      source_checked_at: new Date(time - 1000).toISOString(),
      refresh_due_at: new Date(time + 1000).toISOString(),
      source_sha256: "a".repeat(64),
      boundary_version: "coh-sn-boundaries-" + "a".repeat(16),
      base_evidence_version: "test",
      audit: {},
      limitation:
        "Synthetic conservative upper bound, not an exact observation.",
    };
  });
  return {
    schema_version: 1,
    policy_version: "source-bounded-v1",
    base,
    estimates,
  };
}
Deno.test("bounded-policy reports preserve all 88, original nulls, client parity and estimate deadlines", async () => {
  const envelope = boundedFixture();
  let boundedRead = false;
  const { send } = setup({
    loadScoring: async (_token, bounded) => {
      boundedRead = bounded;
      return envelope;
    },
  });
  for (const tenure of ["rent", "buy"] as const) {
    for (const mode of ["offer", "remote"] as const) {
      const options = { ...generate.options, tenure, mode } as ScoringOptions;
      const response = await send({
        ...generate,
        scoringPolicy: "source-bounded-v1",
        options,
      });
      assert(response.status === 200 && boundedRead);
      const body = await response.json();
      const browserResult = scoreNeighborhoodsWithEstimates(
        body.payload,
        options,
        time,
      );
      assert(browserResult.ranked.length === 88);
      assert(
        browserResult.estimateInputsUsed.length === (tenure === "rent" ? 6 : 5),
      );
      assert(
        body.payload.base.neighborhoods[6].categories.afford.metrics
          .rent_usd === null,
      );
      assert(body.narrative.text.includes(browserResult.ranked[0].name));
      assert(
        body.narrative.facts[0].source.includes("conservative source-derived"),
      );
      assert(Date.parse(body.narrative.expiresAt) === time + 1000);
    }
  }
});
Deno.test("invalid bounded data fails before quota/model; expiry during narration withholds the report", async () => {
  const bad = boundedFixture();
  bad.estimates[0].ranking_value = 1700;
  const failed = setup({ loadScoring: async () => bad });
  assert(
    (await failed.send({ ...generate, scoringPolicy: "source-bounded-v1" }))
      .status === 503,
  );
  assert(failed.calls.model === 0 && failed.calls.reserved === 0);
  let reads = 0;
  const expired = setup({
    loadScoring: async () => boundedFixture(),
    now: () => ++reads > 3 ? time + 1001 : time,
  });
  assert(
    (await expired.send({ ...generate, scoringPolicy: "source-bounded-v1" }))
      .status === 409,
  );
});
Deno.test("nearby policy keeps browser/server parity and rejects a legacy response before quota", async () => {
  const envelope = boundedFixture();
  const base = envelope.base as unknown as ScoringPayload;
  base.model_version = "houston-access-v2";
  for (const row of base.neighborhoods) for (const id of ["amen", "health"] as const) {
    row.categories[id].nearby_access = { radius_meters: 4828.032, facilities: Object.fromEntries(
      Object.keys(row.categories[id].metrics).map(key => [key, { count: 3, weighted_count: 3 / row.neighborhood_id }]),
    ) };
  }
  let nearbyRead = false;
  const { send } = setup({ loadScoring: async (_token, bounded, nearby) => {
    assert(bounded); nearbyRead = nearby === true; return envelope;
  } });
  const response = await send({ ...generate, scoringPolicy: "source-bounded-v1", facilityPolicy: "nearby-3mi-v1" });
  assert(response.status === 200 && nearbyRead);
  const body = await response.json();
  const browser = scoreNeighborhoodsWithEstimates(body.payload, generate.options as ScoringOptions, time);
  assert(browser.modelVersion === "houston-access-v2" && browser.ranked.length === 88);
  assert(body.narrative.text.includes(browser.ranked[0].name));
  assert(browser.results[0].categories.amen.nearbyAccess?.facilities.libraries?.count === 3);
  const old = setup({ loadScoring: async () => boundedFixture() });
  assert((await old.send({ ...generate, scoringPolicy: "source-bounded-v1", facilityPolicy: "nearby-3mi-v1" })).status === 503);
  assert(old.calls.model === 0 && old.calls.reserved === 0);
});
