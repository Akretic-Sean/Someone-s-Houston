import { createRuntimeCheck } from "./handler.ts";
Deno.serve(createRuntimeCheck((name) => Deno.env.get(name)));
