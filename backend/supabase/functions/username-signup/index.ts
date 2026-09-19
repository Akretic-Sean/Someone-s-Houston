import { createHandler } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const serverHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
Deno.serve(createHandler({
  // Public registration uses a project API key, not a user JWT. This verifies
  // publishable and legacy anon keys through this project's Auth gateway.
  async authorize(key) {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) throw new Error("Auth unavailable");
    await response.body?.cancel();
    return true;
  },
  async reserve() {
    const response = await fetch(`${url}/rest/v1/rpc/reserve_username_signup`, {
      method: "POST",
      headers: serverHeaders,
      body: "{}",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Quota unavailable");
    return response.json();
  },
  async create(body) {
    const response = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: serverHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok) {
      await response.body?.cancel();
      return "created";
    }
    const error = await response.json().catch(() => ({}));
    if (error.code === "email_exists" || error.error_code === "email_exists") {
      return "duplicate";
    }
    if (response.status >= 500) throw new Error("Auth unavailable");
    return "rejected";
  },
}));
