import type {
  Consideration,
  FinancialRow,
  Kpi,
  LifestyleCard,
  Neighborhood,
  Report,
  ReportSummary,
} from '../types';
import { DEFAULT_WEIGHTS } from './offices';

/**
 * A fully worked mock report. Every figure here is illustrative and carries the
 * source line it would carry in production. Swap this for a fetch once
 * `GET /reports/:id` exists; the component tree reads `Report` and nothing else.
 */

const NEIGHBORHOODS: Neighborhood[] = [
  {
    id: 'midtown',
    neighborhoodId: 62,
    name: 'Midtown',
    score: 91,
    commute: '8–14 min',
    commuteMode: 'walk, bike, or METRORail',
    afford: 'Within range',
    affordLevel: 'good',
    rent: '1BR median ≈ $1,900',
    flood: 'Clear',
    services: 'Strong',
    momentum: 'Rising',
    why: 'You can walk or take the Red Line to The Ion, which also puts the Museum District a stop away for weekend art walks. A full-size grocery store sits within a 5-minute drive, and the Midtown-to-Montrose stretch covers Vietnamese and Tex-Mex spots plus a dense cluster of specialty coffee. A large climbing gym is about 10 minutes away.',
    safety: 'typical of',
    factors: [
      { label: 'Commute', weight: 96, note: '8–14 min' },
      { label: 'Affordability', weight: 78, note: '$ within range' },
      { label: 'Flood context', weight: 92, note: 'outside 500-yr' },
      { label: 'Dining & grocery', weight: 88, note: 'high density' },
      { label: 'Fitness', weight: 80, note: 'gym 10 min' },
      { label: 'Airport access', weight: 70, note: 'HOU 25 min' },
    ],
  },
  {
    id: 'heights',
    neighborhoodId: 15,
    name: 'The Heights',
    score: 86,
    commute: '15–25 min',
    commuteMode: 'drive or bike trail',
    afford: 'Stretch to buy',
    affordLevel: 'mid',
    rent: '1BR median ≈ $1,750',
    flood: 'Caution',
    services: 'Strong',
    momentum: 'Established',
    why: 'The MKT and White Oak Bayou trails give you long, shaded morning runs from your door, and the bike trail connects toward Downtown. Two full-service grocery stores, a farmers market, and a well-known coffee roaster are inside the neighborhood. Live-music venues cluster along 19th Street and Washington Avenue. Some blocks near the bayou sit in the 500-year floodplain, so check the parcel before signing.',
    safety: 'lower than',
    factors: [
      { label: 'Commute', weight: 74, note: '15–25 min' },
      { label: 'Affordability', weight: 62, note: 'buy is a stretch' },
      { label: 'Flood context', weight: 66, note: 'parts in 500-yr' },
      { label: 'Dining & grocery', weight: 84, note: 'strong' },
      { label: 'Fitness', weight: 92, note: 'trails at door' },
      { label: 'Airport access', weight: 68, note: 'IAH 30 min' },
    ],
  },
  {
    id: 'montrose',
    neighborhoodId: 24,
    name: 'Montrose',
    score: 84,
    commute: '10–18 min',
    commuteMode: 'bike or short drive',
    afford: 'Within range',
    affordLevel: 'good',
    rent: '1BR median ≈ $1,850',
    flood: 'Clear',
    services: 'Typical',
    momentum: 'Steady',
    why: 'The most walkable dining scene among the three, with several of the Vietnamese and Tex-Mex spots you mentioned, and the Menil Collection and Museum District within a short bike ride. Grocery options range from a co-op to a large chain store. Nearest climbing gym is about 12 minutes; Buffalo Bayou Park is the closest long-run route.',
    safety: 'higher than',
    factors: [
      { label: 'Commute', weight: 84, note: '10–18 min' },
      { label: 'Affordability', weight: 76, note: '$ within range' },
      { label: 'Flood context', weight: 90, note: 'outside 500-yr' },
      { label: 'Dining & grocery', weight: 95, note: 'very high' },
      { label: 'Fitness', weight: 74, note: 'park 8 min' },
      { label: 'Airport access', weight: 66, note: 'HOU 28 min' },
    ],
  },
];

const FINANCIAL_ROWS: FinancialRow[] = [
  {
    label: 'Salary',
    origin: '$210,000',
    houston: '$185,000',
    originWidth: 100,
    houstonWidth: 88,
    delta: '−12% on paper',
    direction: 'caution',
    note: 'The offer is lower before taxes and cost of living are considered.',
    source: 'Offer letter; recruiter-entered',
  },
  {
    label: 'Estimated take-home pay',
    origin: '≈ $138,000',
    houston: '≈ $141,000',
    originWidth: 98,
    houstonWidth: 100,
    delta: '≈ +$3,000 / yr in Houston',
    direction: 'good',
    note: 'Texas has no state income tax; California withholds roughly 9% at this level. Federal tax is similar in both.',
    source: '2026 federal and CA brackets, single filer, standard deduction',
  },
  {
    label: 'Median home price vs. salary',
    origin: '≈ 6.2× salary',
    houston: '≈ 1.8× salary',
    originWidth: 100,
    houstonWidth: 29,
    delta: 'Buying becomes plausible',
    direction: 'good',
    note: 'San Francisco median sale ≈ $1.3M; Houston ≈ $340k. Lower ratio means a shorter path to a down payment. Property tax raises Houston’s carrying cost; see note below.',
    source: 'HAR and MLS medians, trailing 6 mo.; Census ACS',
  },
  {
    label: 'Median 1BR rent share of gross pay',
    origin: '≈ 17%',
    houston: '≈ 12%',
    originWidth: 100,
    houstonWidth: 70,
    delta: '≈ $1,300 / mo lower rent',
    direction: 'good',
    note: 'Median asking rent for a 1-bedroom: ≈ $3,000 in San Francisco versus ≈ $1,850 in the recommended Houston areas.',
    source: 'Listing medians, Aug 2026; Census ACS gross rent',
  },
];

const LIFESTYLE: LifestyleCard[] = [
  {
    eyebrow: 'Food and grocery',
    tag: 'Strong fit',
    title: 'Weeknight cooking is easy to sustain here',
    text: 'All three neighborhoods have a full-size grocery store within a five-minute drive, and Houston grocery prices run below the national average. The Vietnamese scene, concentrated along Bellaire and in Midtown, is among the largest in the country, and Tex-Mex is a citywide default. Specialty coffee clusters in Montrose and the Heights.',
    chips: ['Trader Joe’s + H-E-B nearby', 'Vietnamese, Tex-Mex', 'Weekend brunch'],
    source: 'Grocery cost index (C2ER); business licenses, City of Houston Open Data',
  },
  {
    eyebrow: 'Hobbies and recreation',
    tag: 'Strong fit',
    title: 'Trails, museums, and live music within a short ride',
    text: 'Buffalo Bayou Park and the White Oak and MKT trails give you 10+ mile running routes with shade. The Museum District has 19 institutions, several free, a Red Line stop from The Ion. Live music runs from small rooms in the Heights to larger venues Downtown.',
    chips: ['Bayou trails', 'Museum District', '19th St venues'],
    source: 'Houston Parks Board; Houston Museum District Association',
  },
  {
    eyebrow: 'Sports and fitness',
    tag: 'Good fit',
    title: 'Two climbing gyms and a year-round outdoor season',
    text: 'Large climbing gyms sit 10–12 minutes from each recommended area, and morning runs stay comfortable most of the year outside July and August. The Rockets play Downtown; Minute Maid Park is a 10-minute rail ride for Astros games.',
    chips: ['Climbing gyms ×2', 'Rockets, Astros', 'Early-morning runs'],
    source: 'Business listings; Houston Sports Authority',
  },
  {
    eyebrow: 'Houston connectivity',
    tag: 'Two major airports',
    title: 'Two major airports make SF and New York routine trips',
    text: 'Houston is one of the few U.S. cities with two large airports. Bush Intercontinental (IAH) is a United hub with many daily nonstops to San Francisco and New York; Hobby (HOU), about 25 minutes from Midtown, runs frequent Southwest service to both coasts. That means real schedule choice for your twice-monthly trips, and easy access to the West Coast, the Northeast, Mexico, and Latin America.',
    chips: ['IAH · United hub · ~35 min', 'HOU · Southwest · ~25 min', 'SFO and NYC nonstops daily'],
    source: 'Houston Airport System route data, Aug 2026; drive times are typical weekday estimates',
    feature: true,
  },
  {
    eyebrow: 'Healthcare access',
    tag: 'Considered for your household',
    title: 'The Texas Medical Center is a short ride from each area',
    text: 'The Texas Medical Center is the largest medical complex in the world, with more than 60 institutions including MD Anderson, Houston Methodist, Memorial Hermann, and Baylor College of Medicine. From Midtown it is one rail line and about 15 minutes; from the Heights or Montrose, roughly 15–20 minutes by car. Specialist availability depends on your partner’s plan and needs, and we recommend confirming coverage before deciding.',
    chips: ['TMC · 15–20 min', '60+ institutions', 'In-network check advised'],
    source: 'Texas Medical Center; METRO',
  },
];

const CONSIDERATIONS: Consideration[] = [
  {
    title: 'Flood risk varies by location',
    text: 'Houston flooding is block-by-block. Check the FEMA and Harris County flood layers for any specific address, and ask about past claims.',
  },
  {
    title: 'Property taxes belong in the housing math',
    text: 'No state income tax is offset partly by property tax if you buy. Renters carry this indirectly.',
  },
  {
    title: 'Houston is car-oriented in many areas',
    text: 'The three areas here are among the more walkable, but most of the region assumes a car. Budget for one if you don’t own one.',
  },
  {
    title: 'Summer heat is significant',
    text: 'June through September routinely exceeds 95°F with high humidity. Outdoor training shifts early or late.',
  },
  {
    title: 'Not modeled',
    text: 'Equity, bonuses, childcare, insurance premiums, and moving costs are excluded from every figure above.',
  },
];

export const MOCK_REPORT: Report = {
  id: 'demo',
  dataAsOf: 'Aug 2026',
  candidateFirstName: 'Daniel',
  companyName: 'Aurelia Robotics',
  originCity: 'San Francisco',
  officeName: 'The Ion / Midtown',
  mode: 'offer',
  tenure: 'rent',
  weights: DEFAULT_WEIGHTS,
  hero: {
    headline: 'A lower offer can still support',
    headlineEmphasis: 'a bigger life',
    intro:
      'Prepared for Daniel, based on your conversation with Aurelia Robotics and the preferences you shared. Everything here is an estimate you can question. Weights and sources are shown throughout.',
    facts: [
      { label: 'Role', value: 'Senior ML Engineer' },
      { label: 'Moving from', value: 'San Francisco' },
      { label: 'Houston offer', value: '$185,000' },
      { label: 'Office hub', value: 'The Ion / Midtown' },
    ],
    careerTitle: 'Why Houston for your career',
    careerText:
      "Houston's engineering base spans energy, aerospace, healthcare, and a growing software layer connecting them. Energy companies are hiring ML teams for grid and subsurface modeling, NASA and its contractor base sit half an hour from Downtown, and the Texas Medical Center runs one of the largest clinical research operations anywhere. The work is applied and the domain problems are real.",
    howToReadTitle: 'How to read this report',
    howToReadText:
      'Recommendations reflect the priority weights below and public datasets. They are not guarantees about safety, flooding, prices, or travel times. Numbers round to keep the comparison readable, and each one names where it came from.',
  },
  financial: {
    summary:
      "Your Houston offer is about 12% lower on paper. After state income tax and housing, the estimated monthly gap moves in Houston's favor. Property tax is the main item that pushes the other way if you buy.",
    assumptions:
      'Single filer, 2026 federal brackets, standard deduction, no equity or bonus. California state income tax applied to the San Francisco salary; Texas has no state income tax. Take-home excludes 401(k) contributions, health premiums, and local transit or parking costs.',
    rows: FINANCIAL_ROWS,
    propertyTaxNote:
      'Texas has no state income tax, but Harris County effective property-tax rates commonly fall in the 1.8–2.3% range of appraised value. On a $340,000 home that is roughly $6,100 to $7,800 a year, which is why the take-home advantage above narrows if you buy rather than rent.',
  },
  neighborhoods: NEIGHBORHOODS,
  lifestyle: LIFESTYLE,
  considerations: CONSIDERATIONS,
  sources: [
    'City of Houston Open Data',
    'U.S. Census ACS 5-year',
    'Harris Central Appraisal District tax rates',
    'FEMA National Flood Hazard Layer',
    'Harris County Flood Control District',
    'Houston Airport System',
    'HAR listing medians',
  ],
  disclaimer:
    'Estimates only. This report is educational and does not constitute tax, financial, real-estate, legal, or medical advice. Neighborhood indicators are computed from public data and the priority weights set with your recruiter; they are not a judgement about any community or the people who live there.',
};

export const KPIS: Kpi[] = [
  { label: 'Reports created', value: '128', delta: '+14', sub: 'last 30 days' },
  { label: 'Candidate views', value: '342', delta: '+61', sub: 'unique opens' },
  { label: 'Expert opt-ins', value: '27', delta: '21%', sub: 'of viewed reports' },
];

export const REPORT_SUMMARIES: ReportSummary[] = [
  { id: 'r1', name: 'Daniel Reyes', origin: 'San Francisco', role: 'Senior ML Engineer', status: 'Expert opt-in', date: 'Sep 18' },
  { id: 'r2', name: 'Amara Okafor', origin: 'Seattle', role: 'Staff Backend Engineer', status: 'Viewed', date: 'Sep 17' },
  { id: 'r3', name: 'Jonas Lindqvist', origin: 'Denver', role: 'Platform Engineer', status: 'Shared', date: 'Sep 15' },
  { id: 'r4', name: 'Mei-Ling Chao', origin: 'New York', role: 'Data Scientist', status: 'Draft', date: 'Sep 12' },
  { id: 'r5', name: 'Tomás Herrera', origin: 'Austin', role: 'Robotics Engineer', status: 'Viewed', date: 'Sep 9' },
];
