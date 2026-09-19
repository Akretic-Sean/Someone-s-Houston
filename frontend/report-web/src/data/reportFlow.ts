import { validateScoringPayload, type ScoringPayload, type ScoringOptions } from '../../../../shared/scoring.mjs';
import { supabase } from '../lib/supabase';
import type { CandidateProfile } from '../types';

export interface ExtractionField { value: string | null; confidence: 'high' | 'medium' | 'low'; evidence: string | null }
export interface ExtractionResult { status: 'generated' | 'degraded'; data: { fields: Record<keyof CandidateProfile, ExtractionField>; unanswered: string[] } }
export interface Narrative {
  status: 'generated' | 'degraded'; text: string | null; expiresAt: string;
  facts: Array<{ id: string; label: string; value: string; source: string }>;
}
export interface GeneratedReport { payload: ScoringPayload; generatedAt: string; narrative: Narrative }
const messages: Record<string, string> = {
  sign_in_required: 'Please sign in again to continue.',
  invalid_input: 'Review your notes and priorities, then try again.',
  usage_limit: 'The AI usage limit has been reached. Try again in an hour, or continue with the factual report.',
  request_already_started: 'That request already started. Wait for it to finish before trying again.',
  evidence_unavailable: 'Current neighborhood evidence could not be loaded. Please retry shortly.',
  evidence_expired: 'The evidence changed while generating. Please generate again.',
  no_comparable_neighborhoods: 'No neighborhoods have complete evidence for these priorities. Adjust your priorities.',
};
async function invoke(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error('The site is not connected to Supabase yet.');
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError || !auth.session) throw new Error(messages.sign_in_required);
  const { data, error } = await supabase.functions.invoke('report-flow', {
    body, headers: { Authorization: `Bearer ${auth.session.access_token}` }, timeout: 95_000,
  });
  if (error) {
    let code = '';
    if (error.context instanceof Response) {
      try { code = (await error.context.json()).error ?? ''; } catch { /* Use bounded message. */ }
      if (error.context.status === 401) code = 'sign_in_required';
    }
    throw new Error(messages[code] ?? 'The AI service is temporarily unavailable. Please retry or continue with the factual report.');
  }
  return data;
}
export async function extractProfile(transcript: string, answers: CandidateProfile): Promise<ExtractionResult> {
  const result = await invoke({ action: 'extract', requestId: crypto.randomUUID(), input: { transcript, answers } }) as ExtractionResult;
  if (!['generated', 'degraded'].includes(result?.status) || !result.data?.fields) throw new Error('Could not read the extracted answers. Please enter them manually.');
  return result;
}
export async function generateAiReport(options: ScoringOptions, preferences: CandidateProfile): Promise<GeneratedReport> {
  const result = await invoke({ action: 'generate', requestId: crypto.randomUUID(), options, preferences }) as GeneratedReport;
  validateScoringPayload(result?.payload);
  if (!result.narrative || !['generated', 'degraded'].includes(result.narrative.status)
    || !Number.isFinite(Date.parse(result.narrative.expiresAt))
    || (result.narrative.text !== null && typeof result.narrative.text !== 'string')
    || !Array.isArray(result.narrative.facts)) throw new Error('Could not read the report. Please try again.');
  return result;
}
