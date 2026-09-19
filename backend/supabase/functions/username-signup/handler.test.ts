import { createHandler, type Dependencies } from "./handler.ts";
// @deno-types="../../../../shared/username.d.mts"
import { usernameEmail } from "../../../../shared/username.mjs";
function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
function setup(overrides: Partial<Dependencies> = {}) {
  const created: unknown[] = [];
  let reservations = 0;
  const handler = createHandler({
    authorize: async (key) => key === "public-key",
    reserve: async () => {
      reservations++;
      return "allowed";
    },
    create: async (body) => {
      created.push(body);
      return "created";
    },
    ...overrides,
  });
  const call = (body: unknown, key = "public-key") =>
    handler(
      new Request("https://test/username-signup", {
        method: "POST",
        headers: { apikey: key, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { call, handler, created, reservations: () => reservations };
}
const input = { username: "New_User", password: "Example-password-123!" };
Deno.test("signup canonicalizes usernames and fixes server-owned auth properties", async () => {
  const s = setup();
  assert((await s.call(input)).status === 201);
  assert(
    JSON.stringify(s.created[0]) ===
      JSON.stringify({
        email: "new_user@users.someones-houston.invalid",
        password: input.password,
        email_confirm: true,
        user_metadata: { username: "new_user" },
      }),
  );
  assert(usernameEmail(" New_User ") === usernameEmail("new_user"));
});
Deno.test("signup rejects supplied emails, privileges, short passwords and oversized bodies before reserving", async () => {
  const s = setup();
  for (
    const body of [
      { ...input, email: "victim@example.com" },
      { ...input, app_metadata: { role: "admin" } },
      { ...input, username: "a@b.com" },
      { ...input, password: "short" },
    ]
  ) assert((await s.call(body)).status === 400);
  assert(
    (await s.call({ ...input, password: "x".repeat(5000) })).status === 413,
  );
  assert(s.reservations() === 0);
  assert(s.created.length === 0);
});
Deno.test("signup checks project key and quota before creating accounts", async () => {
  const missing = setup();
  assert((await missing.call(input, "")).status === 401);
  assert(missing.reservations() === 0);
  const limited = setup({ reserve: async () => "limited" });
  assert((await limited.call(input)).status === 429);
  assert(limited.created.length === 0);
  const failed = setup({
    reserve: async () => {
      throw new Error("secret error");
    },
  });
  const response = await failed.call(input);
  assert(response.status === 503);
  assert(!(await response.text()).includes("secret"));
  assert(failed.created.length === 0);
});
Deno.test("signup returns bounded duplicate/rejection errors and preflight never creates an account", async () => {
  assert(
    (await setup({ create: async () => "duplicate" }).call(input)).status ===
      409,
  );
  assert(
    (await setup({ create: async () => "rejected" }).call(input)).status ===
      400,
  );
  const s = setup();
  assert(
    (await s.handler(new Request("https://test", { method: "OPTIONS" })))
      .status === 204,
  );
  assert((await s.handler(new Request("https://test"))).status === 405);
  assert(s.created.length === 0);
});
