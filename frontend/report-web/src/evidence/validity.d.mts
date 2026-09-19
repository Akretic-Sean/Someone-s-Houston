import type { ScoringNeighborhood } from '../../../../shared/scoring.mjs';
import type { Category, EvidenceNeighborhood, WithheldReason } from './types';
export function categoryWithheldReason(category: Category | null | undefined, now?: number): WithheldReason | null;
export function evidenceMatchesScoring(evidenceNeighborhood: EvidenceNeighborhood | null | undefined, scoringNeighborhood: ScoringNeighborhood | null | undefined): boolean;
