import { z } from "zod";

export const FIELD_IDS = [
  "role",
  "city",
  "salary",
  "offer",
  "office",
  "grocery",
  "food",
  "hobbies",
  "sports",
  "workout",
  "airport",
  "health",
] as const;
export const FieldId = z.enum(FIELD_IDS);
const Field = z.object({
  value: z.string().max(500).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.string().max(2000).nullable(),
}).strict();
export const ExtractionSchema = z.object({
  fields: z.object(
    Object.fromEntries(FIELD_IDS.map((id) => [id, Field])) as Record<
      typeof FIELD_IDS[number],
      typeof Field
    >,
  ).strict(),
  unanswered: z.array(FieldId).max(FIELD_IDS.length),
}).strict();
export const NarrationSchema = z.object({
  prose: z.string().min(1).max(1600),
  facts_used: z.array(z.string().min(1).max(100)).max(24),
  preferences_used: z.array(FieldId).max(FIELD_IDS.length),
}).strict();
export const FormSchema = z.object(
  Object.fromEntries(
    FIELD_IDS.map((id) => [id, z.string().max(500).optional()]),
  ) as Record<typeof FIELD_IDS[number], z.ZodOptional<z.ZodString>>,
).strict();
export const ExtractionInput = z.object({
  transcript: z.string().max(24000),
  answers: FormSchema,
}).strict();
export const NarrationInput = z.object({
  section: z.string().min(1).max(80),
  facts: z.array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/),
      label: z.string().min(1).max(150),
      value: z.string().min(1).max(500),
      source: z.string().min(1).max(500),
      refresh_due_at: z.string().datetime(),
    }).strict(),
  ).min(1).max(24),
  preferences: FormSchema,
}).strict();
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Narration = z.infer<typeof NarrationSchema>;

export function formOnly(answers: z.infer<typeof FormSchema>): Extraction {
  const fields = Object.fromEntries(FIELD_IDS.map((id) => [id, {
    value: answers[id]?.trim() || null,
    confidence: answers[id]?.trim() ? "high" : "low",
    evidence: null,
  }]));
  return ExtractionSchema.parse({
    fields,
    unanswered: FIELD_IDS.filter((id) => !answers[id]?.trim()),
  });
}

// This check is deliberately separate from the SDK's schema conversion/validation.
export function verifyExtraction(
  raw: unknown,
  input: z.infer<typeof ExtractionInput>,
): Extraction {
  const result = ExtractionSchema.parse(raw);
  const fallback = formOnly(input.answers);
  for (const id of FIELD_IDS) {
    const field = result.fields[id];
    // Explicit form answers win. An exact quote is provenance, not proof of meaning;
    // extracted values still require review before they become ranking preferences.
    if (
      input.answers[id]?.trim() || !field.value || !field.evidence?.trim() ||
      !input.transcript.includes(field.evidence)
    ) {
      result.fields[id] = fallback.fields[id];
    }
  }
  result.unanswered = FIELD_IDS.filter((id) =>
    result.fields[id].value === null
  );
  return result;
}

const forbidden =
  /\b(?:safe|safer|safest|crime|drive\s*time|minutes?\s*(?:away|drive|walk|commute)|walkable|walking\s*distance|will\s*flood|won[’']?t\s*flood|flood\s*risk|good\s*area|nice\s*area|up.and.coming|desirable|will\s*appreciate|good\s*investment|prices\s*will|demographic|ethnic|racial|religious)\b/i;
const numeric =
  /[\p{N}$%]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|percent|double|triple)\b/iu;
export function verifyNarration(
  raw: unknown,
  input: z.infer<typeof NarrationInput>,
): Narration {
  const result = NarrationSchema.parse(raw);
  const ids = new Set(input.facts.map((fact) => fact.id));
  if (
    result.facts_used.some((id) => !ids.has(id)) ||
    result.preferences_used.some((id) => !input.preferences[id]?.trim())
  ) {
    throw new Error("Unknown reference");
  }
  if (!result.facts_used.length) throw new Error("No supporting facts");
  const text = result.prose.replace(
    /\[fact:([a-z][a-z0-9_.-]*)\]/g,
    (_match, id: string) => {
      if (!ids.has(id) || !result.facts_used.includes(id)) {
        throw new Error(
          "Unknown fact placeholder",
        );
      }
      return "";
    },
  );
  if (numeric.test(text) || forbidden.test(text) || /\[fact:/.test(text)) {
    throw new Error("Unsupported prose");
  }
  return result;
}
