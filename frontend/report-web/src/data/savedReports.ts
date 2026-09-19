import { supabase } from '../lib/supabase';
import type { ReportConfig } from '../App';
import type { GeneratedReport } from './reportFlow';
export interface SavedReport { id: string; title: string; created_at: string; config: ReportConfig }
export async function listReports(userId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error, count } = await supabase.from('saved_reports').select('id,title,created_at,config', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error('Saved reports could not be loaded. Please retry.');
  return { rows: (data ?? []) as SavedReport[], count: count ?? 0 };
}
export async function saveReport(id: string, userId: string, config: ReportConfig, report: GeneratedReport) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const title = [config.profile.role || 'Relocation report', config.profile.city].filter(Boolean).join(' — ').slice(0, 200);
  const { error } = await supabase.from('saved_reports').upsert({ id, user_id: userId, title, config, snapshot: report }, { onConflict: 'id' });
  if (error) throw new Error('Your report is ready but was not saved. Retry saving before leaving this page.');
}
