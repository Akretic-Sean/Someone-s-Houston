import {
  createReportModelClient,
  modelConfigFromEnv,
} from "../_shared/report-models/mod.ts";

export function createRuntimeCheck(
  get: (name: string) => string | undefined,
  makeClient = createReportModelClient,
) {
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    // Modern Supabase secret keys are not JWTs. Gateway verification is off;
    // this handler authorizes exact server-only keys before any paid calls.
    const apiKey = request.headers.get("apikey") ?? "";
    let modernKeys: string[] = [];
    try {
      const values = Object.values(
        JSON.parse(get("SUPABASE_SECRET_KEYS") ?? "{}"),
      );
      modernKeys = values.filter((value): value is string =>
        typeof value === "string" && value.startsWith("sb_secret_")
      );
    } catch { /* No modern key is trusted when configuration is malformed. */ }
    const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");
    const legacyAuthorized = Boolean(serviceKey) &&
      request.headers.get("authorization") === `Bearer ${serviceKey}`;
    if (!modernKeys.includes(apiKey) && !legacyAuthorized) {
      return json({ error: "forbidden" }, 403);
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    try {
      const config = modelConfigFromEnv(get);
      if (
        !config.apiKey || !config.extractionModels.length ||
        !config.narrationModels.length
      ) return json({ error: "model_configuration_missing" }, 503);
      const client = makeClient(config);
      // Ignore request bodies: only synthetic fixtures can leave this endpoint.
      const extraction = await client.extract({
        transcript: "I cook most evenings.",
        answers: {},
      });
      const narration = await client.narrate({
        section: "runtime_check",
        facts: [{
          id: "food.grocery",
          label: "Grocery inventory",
          value: "Grocery locations are mapped.",
          source: "Synthetic runtime fixture; not Houston evidence.",
          refresh_due_at: new Date(Date.now() + 60000).toISOString(),
        }],
        preferences: { grocery: "I cook most evenings." },
      });
      const extracted = extraction.status === "generated" &&
        [extraction.data.fields.grocery, extraction.data.fields.food].some(
          (field) =>
            field.value !== null && Boolean(field.evidence?.trim()) &&
            "I cook most evenings.".includes(field.evidence!),
        );
      const narrated = narration.status === "generated" &&
        narration.data.facts_used.includes("food.grocery");
      return json({
        ok: extracted && narrated,
        extraction: extracted
          ? "passed"
          : extraction.reason ?? "verification_failed",
        narration: narrated
          ? "passed"
          : narration.reason ?? "verification_failed",
      }, extracted && narrated ? 200 : 502);
    } catch {
      return json({ error: "runtime_check_failed" }, 502);
    }
  };
}
