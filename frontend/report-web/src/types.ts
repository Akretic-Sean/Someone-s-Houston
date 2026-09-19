/**
 * The report contract.
 *
 * This is the shape `frontend/` renders and `backend/` must produce. It is
 * mirrored in prose in `docs/api.md`. Nothing in this file is derived from the
 * mock data: the mock conforms to these types, not the other way round.
 *
 * Rule carried over from the build plan: every number a candidate sees is
 * paired with a `source` string. That is why `source` is required, not
 * optional, on each section that carries figures.
 */

export type OfficeId = 'ion' | 'downtown' | 'energy' | 'tmc' | 'nasa';

export interface Office {
  id: OfficeId;
  label: string;
  sub: string;
  /** Approximate office location, for the map. Not a precise address. */
  lat: number;
  lon: number;
}

/** Offer mode compares two salaries; remote mode carries the salary over. */
export type ReportMode = 'offer' | 'remote';
export type Tenure = 'rent' | 'buy';

/** How confident extraction was in a field it pulled off a call transcript. */
export type Confidence = 'High' | 'Medium' | 'Low';

/** The eight scoring dimensions the recruiter can weight. */
export type WeightId =
  | 'afford'
  | 'commute'
  | 'flood'
  | 'amen'
  | 'fit'
  | 'food'
  | 'air'
  | 'health';

export interface WeightDef {
  id: WeightId;
  label: string;
  /** Default slider position, 0–10. */
  value: number;
}

export type Weights = Record<WeightId, number>;

/** What extraction pulls out of the recruiter conversation. */
export interface CandidateProfile {
  role: string;
  city: string;
  salary: string;
  offer: string;
  office: string;
  grocery: string;
  food: string;
  hobbies: string;
  sports: string;
  workout: string;
  airport: string;
  health: string;
}

export type ProfileField = keyof CandidateProfile;
export type ProfileConfidence = Record<ProfileField, Confidence>;

export type FloodTier = 'Clear' | 'Caution' | 'Avoid';
export type AffordLevel = 'good' | 'mid' | 'low';
/** Tiers only, never a ranked list — HPD advises against raw area comparison. */
export type SafetyTier = 'lower than' | 'typical of' | 'higher than';

export interface NeighborhoodFactor {
  label: string;
  /** 0–100, how well this area serves that dimension. */
  weight: number;
  note: string;
}

export interface Neighborhood {
  id: string;
  /**
   * The City's Super Neighborhood `POLYID`, 1-88. This is the join key onto the
   * live `neighborhood_profiles` layer — never join on a matched name.
   */
  neighborhoodId: number;
  name: string;
  /** 0–100, relative to the other returned areas only. */
  score: number;
  commute: string;
  commuteMode: string;
  afford: string;
  affordLevel: AffordLevel;
  rent: string;
  flood: FloodTier;
  services: string;
  momentum: string;
  /** Prose the candidate reads; written against their stated preferences. */
  why: string;
  safety: SafetyTier;
  factors: NeighborhoodFactor[];
}

/** A neighborhood joined onto the live reference layer, ready to render. */
export interface ResolvedNeighborhood extends Neighborhood {
  lat: number;
  lon: number;
  /** Monthly gross rent, whole USD. Null renders as "Unavailable". */
  medianGrossRent: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  /**
   * Candidate salary divided by the neighborhood's median household income.
   * The build plan's "live like a king" number. Null when income is suppressed.
   */
  standing: number | null;
  /** True when the figures came from the live layer rather than the mock. */
  live: boolean;
}

/** One row of the side-by-side money comparison. */
export interface FinancialRow {
  label: string;
  /** Value in the origin city. */
  origin: string;
  /** Value in Houston. */
  houston: string;
  /** Bar widths, 0–100, relative to each other within the row. */
  originWidth: number;
  houstonWidth: number;
  delta: string;
  /** Which way the delta reads for the candidate. */
  direction: 'good' | 'caution' | 'bad';
  note: string;
  source: string;
}

export interface LifestyleCard {
  eyebrow: string;
  tag: string;
  title: string;
  text: string;
  chips: string[];
  source: string;
  /** Feature cards span the full grid width. */
  feature?: boolean;
}

export interface Consideration {
  title: string;
  text: string;
}

export interface HeroFact {
  label: string;
  value: string;
}

/** The whole document. One of these is what `build_report` stores and returns. */
export interface Report {
  id: string;
  /** Rendered under the logo, e.g. "Aug 2026". */
  dataAsOf: string;
  candidateFirstName: string;
  companyName: string;
  originCity: string;
  officeName: string;
  mode: ReportMode;
  tenure: Tenure;
  weights: Weights;
  hero: {
    headline: string;
    headlineEmphasis: string;
    intro: string;
    facts: HeroFact[];
    careerTitle: string;
    careerText: string;
    howToReadTitle: string;
    howToReadText: string;
  };
  financial: {
    summary: string;
    assumptions: string;
    rows: FinancialRow[];
    propertyTaxNote: string;
  };
  neighborhoods: Neighborhood[];
  lifestyle: LifestyleCard[];
  considerations: Consideration[];
  sources: string[];
  disclaimer: string;
}

/** A row in the recruiter's dashboard list. */
export type ReportStatus = 'Viewed' | 'Shared' | 'Draft' | 'Expert opt-in';

export interface ReportSummary {
  id: string;
  name: string;
  origin: string;
  role: string;
  status: ReportStatus;
  date: string;
}

export interface Kpi {
  label: string;
  value: string;
  delta: string;
  sub: string;
}

/** What the candidate submits on the opt-in. Nothing is sent without consent. */
export interface ExpertLead {
  reportId: string;
  email: string;
  consent: true;
}
