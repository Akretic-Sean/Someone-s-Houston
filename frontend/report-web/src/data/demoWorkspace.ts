import type { ReportConfig } from '../App';
import type { SavedReport } from './savedReports';
import { DEFAULT_WEIGHTS } from './offices';

export const DEMO_CANDIDATES = [
  { id: 'demo-maya', name: 'Maya Chen', role: 'Robotics engineer', city: 'Seattle', goal: 'Compare renting near the aerospace hub with buying.', office: 'nasa' },
  { id: 'demo-jordan', name: 'Jordan Brooks', role: 'Platform engineer', city: 'Denver', goal: 'Work remotely with more room in the housing budget.', office: 'ion' },
  { id: 'demo-alex', name: 'Alex Rivera', role: 'Health data scientist', city: 'Boston', goal: 'Prioritize access to the medical center and healthcare.', office: 'tmc' },
] as const;
export interface DemoReport extends SavedReport { candidateId: string; scenario: string; status: 'Draft' | 'Viewed' | 'Shared' }
function report(id: string, candidateIndex: number, scenario: string, status: DemoReport['status'], overrides: Partial<ReportConfig>): DemoReport {
  const candidate = DEMO_CANDIDATES[candidateIndex];
  return { id, candidateId: candidate.id, title: `${candidate.name}: ${scenario}`, scenario, status, created_at: '2026-09-19T15:00:00Z',
    config: { profile: { role: candidate.role, city: candidate.city, salary: '', offer: '', office: candidate.office, grocery: '', food: '', hobbies: '', sports: '', workout: '', airport: '', health: '' },
      office: candidate.office, airport: 'nearest', mode: 'offer', tenure: 'rent', weights: { ...DEFAULT_WEIGHTS }, ...overrides } };
}
export const DEMO_REPORTS: DemoReport[] = [
  report('demo-maya-rent', 0, 'Rent near work', 'Viewed', { weights: { ...DEFAULT_WEIGHTS, commute: 10, flood: 9 } }),
  report('demo-maya-buy', 0, 'Explore buying', 'Draft', { tenure: 'buy', weights: { ...DEFAULT_WEIGHTS, afford: 10, flood: 10 } }),
  report('demo-jordan-remote', 1, 'Remote lifestyle', 'Shared', { mode: 'remote', weights: { ...DEFAULT_WEIGHTS, afford: 10, commute: 0, fit: 9 } }),
  report('demo-alex-medical', 2, 'Medical center access', 'Viewed', { weights: { ...DEFAULT_WEIGHTS, health: 10, commute: 9 } }),
];
// All insight counts derive from the same linked records shown in the tables.
export function demoInsights() {
  return { candidates: DEMO_CANDIDATES.length, reports: DEMO_REPORTS.length,
    viewed: DEMO_REPORTS.filter(r => r.status === 'Viewed').length,
    remote: DEMO_REPORTS.filter(r => r.config.mode === 'remote'),
    comparisons: DEMO_CANDIDATES.filter(c => DEMO_REPORTS.filter(r => r.candidateId === c.id).length > 1) };
}
