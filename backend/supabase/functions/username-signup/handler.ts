import { z } from "zod";
// @deno-types="../../../../shared/username.d.mts"
import { usernameEmail } from "../../../../shared/username.mjs";
const inputSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
  password: z.string().min(8).max(128),
}).strict();
export type Dependencies = {
  authorize: (key: string) => Promise<boolean>;
  reserve: () => Promise<string>;
  create: (
    body: {
      email: string;
      password: string;
      email_confirm: true;
      user_metadata: { username: string };
    },
  ) => Promise<"created" | "duplicate" | "rejected">;
};
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
export function createHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, error?: string) =>
      new Response(JSON.stringify(error ? { error } : { created: true }), {
        status,
        headers,
      });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return reply(405, "method_not_allowed");
    try {
      const key = request.headers.get("apikey");
      if (!key || key.length > 2048 || !(await deps.authorize(key))) {
        return reply(401, "invalid_project_key");
      }
      if (!request.headers.get("content-type")?.includes("application/json")) {
        return reply(400, "invalid_request");
      }
      const reader = request.body?.getReader();
      if (!reader) return reply(400, "invalid_request");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) {
          await reader.cancel();
          return reply(413, "request_too_large");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return reply(400, "invalid_request");
      }
      const parsed = inputSchema.safeParse(json);
      if (!parsed.success) return reply(400, "invalid_username_or_password");
      const reservation = await deps.reserve();
      if (reservation === "limited") return reply(429, "signup_limit");
      if (reservation !== "allowed") return reply(503, "signup_unavailable");
      const result = await deps.create({
        email: usernameEmail(parsed.data.username),
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: { username: parsed.data.username },
      });
      if (result === "duplicate") return reply(409, "username_unavailable");
      if (result !== "created") return reply(400, "signup_rejected");
      return reply(201);
    } catch {
      return reply(503, "signup_unavailable");
    }
  };
}
