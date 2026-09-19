import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryWithheldReason, evidenceMatchesScoring } from '../src/evidence/validity.mjs';

const NOW = Date.parse('2026-09-19T20:00:00Z');
const category = { availability: 'partial', facts: { median_home_value_usd: 200000 }, refresh_due_at: '2026-10-01T20:00:00Z' };

test('missing and malformed deadlines withhold otherwise usable facts', () => {
  for (const value of [undefined, null, '', 'tomorrow', '2026-10-01', '2026-02-30T20:00:00Z', '2026-10-01T25:00:00Z']) {
    assert.equal(categoryWithheldReason({ ...category, refresh_due_at: value }, NOW), 'needs_refresh', String(value));
  }
  assert.equal(categoryWithheldReason(category, NOW), null);
  assert.equal(categoryWithheldReason({ ...category, refresh_due_at: '2026-09-19T20:00:00Z' }, NOW), 'expired');
  assert.equal(categoryWithheldReason({ ...category, refresh_due_at: '2026-10-01T20:00:00.123456+00:00' }, NOW), null);
});

test('detail evidence must match neighborhood and every scoring category publication', () => {
  const categories = Object.fromEntries(['afford', 'commute', 'flood', 'amen', 'fit', 'food', 'air', 'health'].map(id => [id, { evidence_version: 'published-version-a' }]));
  const scoring = { neighborhood_id: 62, categories };
  const detail = structuredClone(scoring);
  assert.equal(evidenceMatchesScoring(detail, scoring), true);
  detail.categories.food.evidence_version = 'published-version-b';
  assert.equal(evidenceMatchesScoring(detail, scoring), false);
  assert.equal(evidenceMatchesScoring({ ...scoring, neighborhood_id: 7 }, scoring), false);
  const missing = structuredClone(scoring);
  delete missing.categories.afford.evidence_version;
  assert.equal(evidenceMatchesScoring(missing, scoring), false);
  assert.equal(evidenceMatchesScoring(undefined, scoring), false);
});
