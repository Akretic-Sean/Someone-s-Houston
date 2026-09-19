import {
  createReportModelClient,
  FIELD_IDS,
  formOnly,
  verifyExtraction,
  verifyNarration,
} from "./mod.ts";
import { createRuntimeCheck } from "../../model-runtime-check/handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function rejects(fn: () => unknown) {
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  assert(rejected);
}
function fixture() {
  const result = formOnly({});
  result.fields.grocery = {
    value: "Cooks regularly",
    confidence: "high",
    evidence: "I cook most evenings.",
  };
  return result;
}
const input = { transcript: "I cook most evenings.", answers: {} };
const narrationInput = {
  section: "food",
  facts: [{
    id: "food.grocery",
    label: "Grocery locations",
    value: "12",
    source: "Synthetic fixture",
    refresh_due_at: "2099-01-01T00:00:00Z",
  }],
  preferences: { grocery: "Cooking" },
};
const narrative = {
  prose:
    "Mapped grocery locations support your cooking preference: [fact:food.grocery].",
  facts_used: ["food.grocery"],
  preferences_used: ["grocery"],
};
function mockProvider(outputs: unknown[], status = 200) {
  const requests: Record<string, any>[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String((init as { body?: BodyInit })?.body));
    requests.push(body);
    if (status !== 200) {
      return new Response(
        JSON.stringify({ error: { message: "synthetic failure" } }),
        { status },
      );
    }
    return Response.json({
      id: "synthetic",
      model: "test/primary",
      created: 1,
      object: "chat.completion",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify(outputs.shift()),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    });
  };
  return { fetch, requests };
}
function client(
  mock: ReturnType<typeof mockProvider>,
  apiKey = "synthetic-key",
) {
  return createReportModelClient({
    apiKey,
    extractionModels: ["test/primary", "test/fallback"],
    narrationModels: ["test/primary", "test/fallback"],
    fetch: mock.fetch,
  });
}

Deno.test("SDK sends JSON schema, fallback order, privacy constraints and bounded tokens", async () => {
  const mock = mockProvider([fixture()]);
  const result = await client(mock).extract(input);
  assert(result.status === "generated");
  assert(result.data.fields.grocery.value === "Cooks regularly");
  assert(mock.requests.length === 1);
  const body = mock.requests[0];
  assert(body.response_format.type === "json_schema");
  assert(
    body.response_format.json_schema.schema.properties.fields.properties
      .grocery,
  );
  assert(
    JSON.stringify(body.models) ===
      JSON.stringify(["test/primary", "test/fallback"]),
  );
  assert(
    body.provider.zdr && body.provider.data_collection === "deny" &&
      body.provider.require_parameters,
  );
  assert(body.temperature === 0);
  assert((body.max_tokens ?? body.max_completion_tokens) === 2400);
  assert(!body.tools);
});
Deno.test("independent extraction validation rejects schema changes and ungrounded evidence", () => {
  rejects(() => verifyExtraction({ ...fixture(), injected: true }, input));
  const bad = fixture();
  bad.fields.grocery.evidence = "Not in transcript";
  assert(verifyExtraction(bad, input).fields.grocery.value === null);
  const explicit = verifyExtraction(fixture(), {
    ...input,
    answers: { grocery: "User correction" },
  });
  assert(explicit.fields.grocery.value === "User correction");
  assert(explicit.fields.grocery.evidence === null);
  assert(explicit.unanswered.length === FIELD_IDS.length - 1);
});
Deno.test("provider failure or missing key degrades to form answers without output leakage", async () => {
  const mock = mockProvider([], 503);
  const result = await client(mock).extract({
    ...input,
    answers: { role: "Engineer" },
  });
  assert(
    result.status === "degraded" &&
      result.data.fields.role.value === "Engineer",
  );
  assert(mock.requests.length === 1);
  const noKeyMock = mockProvider([]);
  const noKey = await client(noKeyMock, "").extract(input);
  assert(noKey.reason === "unconfigured" && noKeyMock.requests.length === 0);
});
Deno.test("narration independently rejects invented references, numbers and forbidden claims", () => {
  assert(verifyNarration(narrative, narrationInput).facts_used.length === 1);
  for (
    const prose of [
      "Rent is $1800.",
      "A five-minute walk.",
      "A safe area.",
      "Prices will appreciate.",
      "[fact:made.up]",
    ]
  ) rejects(() => verifyNarration({ ...narrative, prose }, narrationInput));
  rejects(() =>
    verifyNarration({ ...narrative, facts_used: ["made.up"] }, narrationInput)
  );
  rejects(() =>
    verifyNarration(
      { ...narrative, preferences_used: ["health"] },
      narrationInput,
    )
  );
  rejects(() => verifyNarration({ ...narrative, score: 99 }, narrationInput));
});
Deno.test("bad narration retries once then omits prose; valid retry can succeed", async () => {
  const bad = { ...narrative, prose: "This is a safe area." };
  const mock = mockProvider([bad, bad]);
  const result = await client(mock).narrate(narrationInput);
  assert(result.status === "degraded" && result.data === null);
  assert(mock.requests.length === 2);
  const retry = mockProvider([bad, narrative]);
  assert((await client(retry).narrate(narrationInput)).status === "generated");
});
Deno.test("stale evidence, oversized transcripts and report call budgets block provider calls", async () => {
  const mock = mockProvider([fixture()]);
  const api = client(mock);
  await api.extract(input);
  assert((await api.extract(input)).reason === "budget_exceeded");
  assert(
    (await api.narrate({
      ...narrationInput,
      facts: [{
        ...narrationInput.facts[0],
        refresh_due_at: "2000-01-01T00:00:00Z",
      }],
    })).reason === "stale_evidence",
  );
  let failed = false;
  try {
    await api.extract({ ...input, transcript: "x".repeat(24001) });
  } catch {
    failed = true;
  }
  assert(failed);
  assert(mock.requests.length === 1);
});
Deno.test("concurrent narrative sections share a synchronous six-section budget", async () => {
  const mock = mockProvider(Array(6).fill(narrative));
  const api = client(mock);
  const results = await Promise.all(
    Array.from({ length: 7 }, () => api.narrate(narrationInput)),
  );
  assert(results.filter((r) => r.status === "generated").length === 6);
  assert(results[6].reason === "budget_exceeded");
  assert(mock.requests.length === 6);
});
Deno.test("runtime check denies anonymous and ordinary users before constructing model client", async () => {
  let calls = 0;
  const handler = createRuntimeCheck(
    (name) =>
      name === "SUPABASE_SERVICE_ROLE_KEY" ? "operator-only" : undefined,
    () => {
      calls++;
      throw Error("must not run");
    },
  );
  for (const token of ["", "public-publishable", "user-jwt"]) {
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    assert(response.status === 403);
  }
  assert(calls === 0);
  assert(
    (await handler(
      new Request("https://example.test", {
        headers: { authorization: "Bearer operator-only" },
      }),
    )).status === 405,
  );
});

Deno.test("runtime check accepts only exact modern secret keys and fails closed on malformed config", async () => {
  const modern = createRuntimeCheck((name) =>
    name === "SUPABASE_SECRET_KEYS"
      ? JSON.stringify({ default: "sb_secret_operator" })
      : undefined
  );
  const request = (key: string) =>
    new Request("https://example.test", {
      method: "POST",
      headers: { apikey: key },
    });
  assert((await modern(request("sb_publishable_example"))).status === 403);
  assert((await modern(request("sb_secret_wrong"))).status === 403);
  assert((await modern(request("sb_secret_operator"))).status === 503); // Authorized, model config absent.
  const malformed = createRuntimeCheck((name) =>
    name === "SUPABASE_SECRET_KEYS" ? "malformed" : undefined
  );
  assert((await malformed(request("sb_secret_operator"))).status === 403);
});

Deno.test("operator runtime fixture accepts grounded cooking under food or grocery", async () => {
  const extracted = fixture();
  extracted.fields.food = {
    ...extracted.fields.grocery,
    evidence: "cook most evenings",
  };
  extracted.fields.grocery = { value: null, evidence: null, confidence: "low" };
  const mock = mockProvider([extracted, narrative]);
  const handler = createRuntimeCheck(
    (name) => ({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_operator" }),
      OPENROUTER_API_KEY: "synthetic",
      OPENROUTER_EXTRACTION_MODELS: "test/primary",
      OPENROUTER_NARRATION_MODELS: "test/primary",
    }[name]),
    (config) => createReportModelClient({ ...config, fetch: mock.fetch }),
  );
  const result = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { apikey: "sb_secret_operator" },
      body: "User text must never be forwarded",
    }),
  );
  assert(result.status === 200);
  assert((await result.json()).ok);
  assert(
    !JSON.stringify(mock.requests).includes(
      "User text must never be forwarded",
    ),
  );
});
