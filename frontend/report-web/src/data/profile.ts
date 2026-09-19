import type { CandidateProfile, ProfileConfidence, ProfileField } from '../types';

/**
 * Mock extraction output. In the real product these fields come from running
 * the recruiter call transcript through the model, which is why each one
 * carries a confidence the recruiter can sanity-check before generating.
 */
export const PROFILE_DEFAULTS: CandidateProfile = {
  role: 'Senior ML Engineer',
  city: 'San Francisco',
  salary: '$210,000',
  offer: '$185,000',
  office: 'The Ion, Midtown',
  grocery:
    'Shops at Trader Joe’s and a local co-op; cooks most weeknights; watches the grocery bill',
  food: 'Vietnamese, Tex-Mex, third-wave coffee; weekend brunch with partner',
  hobbies: 'Trail running, live music, museums and art walks with partner',
  sports: 'Follows the NBA; open to catching Astros games',
  workout: 'Climbing gym 3x a week, early-morning runs',
  airport: 'Flies to SF and NYC roughly twice a month; nonstop options matter',
  health:
    'Partner has ongoing specialist appointments; wants a major hospital system nearby',
};

export const PROFILE_CONFIDENCE: ProfileConfidence = {
  role: 'High',
  city: 'High',
  salary: 'High',
  offer: 'High',
  office: 'High',
  grocery: 'Medium',
  food: 'Medium',
  hobbies: 'Medium',
  sports: 'Low',
  workout: 'Medium',
  airport: 'High',
  health: 'Medium',
};

export const OFFER_FIELDS: Array<[ProfileField, string]> = [
  ['role', 'Role'],
  ['city', 'Current city'],
  ['salary', 'Current salary'],
  ['offer', 'Houston offer'],
  ['office', 'Work location'],
];

export const LIFESTYLE_FIELDS: Array<[ProfileField, string]> = [
  ['grocery', 'Grocery preferences and budget'],
  ['food', 'Restaurants and cuisine'],
  ['hobbies', 'Hobbies and local activities'],
  ['sports', 'Sports interests'],
  ['workout', 'Workout preferences'],
  ['airport', 'Airport and travel needs'],
  ['health', 'Healthcare considerations'],
];

export const TRANSCRIPT = `Recruiter: Tell me a bit about where you're living now and what a move would need to work for you.
Daniel: We're in the Mission. My partner works remotely, so the flexibility is there, but she has specialist appointments every few weeks, so being near a real hospital system matters.
Recruiter: Understood. What does a normal week look like outside work?
Daniel: Climbing gym three times a week, early runs. Weekends we'll do a museum or a trail, and we cook most nights, so a good grocery store within a few minutes is a big deal. We're a little budget-conscious on that front.
Recruiter: Food-wise?
Daniel: Vietnamese, Tex-Mex, and I'm picky about coffee. We go out for brunch on weekends.
Recruiter: Travel?
Daniel: I fly back to SF and to New York maybe twice a month. Nonstops matter. I also follow the NBA, and I'd try an Astros game.`;
