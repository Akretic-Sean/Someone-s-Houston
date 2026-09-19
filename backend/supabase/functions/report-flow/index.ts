import {
  createReportModelClient,
  modelConfigFromEnv,
} from "../_shared/report-models/mod.ts";
import { createHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
// Supabase-provided legacy keys are confined to this server; no additional Vercel secret.
const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function rpc(name: string, body: unknown, token: string, key: string) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("RPC unavailable");
  return response.json();
}
Deno.serve(createHandler({
  async authenticate(token) {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error("Auth unavailable");
    const user = await response.json();
    return typeof user.id === "string" && user.email_confirmed_at &&
        !user.is_anonymous
      ? user.id
      : null;
  },
  reserve: (userId, requestId) =>
    rpc(
      "reserve_report_ai_request",
      { p_user_id: userId, p_request_id: requestId },
      serviceKey,
      serviceKey,
    ),
  loadScoring: (token) =>
    rpc("get_neighborhood_scoring_data", {}, token, publicKey),
  models: () =>
    createReportModelClient(modelConfigFromEnv((name) => Deno.env.get(name))),
}));
