import type { EstimateInput } from '../../../../shared/scoring-estimates.mjs';

export default function EstimateDisclosure({ inputs }: { inputs: EstimateInput[] }) {
  if (!inputs.length) return null;
  return <aside className="estimate-disclosure" aria-label="Conservative ranking inputs">
    <strong>Includes a conservative source-derived estimate</strong>
    <ul>{inputs.map(input => <li key={input.metric}>
      {input.metric === 'rent_usd'
        ? <>Exact median unavailable. Ranking uses ${input.upper_bound.toLocaleString()} upper end of the published ${input.lower_bound.toLocaleString()}–${input.upper_bound.toLocaleString()} monthly gross-rent band.</>
        : <>Mapped flood-zone classification interval: {input.lower_bound.toFixed(4)}–{input.upper_bound.toFixed(4)}% of neighborhood area. Ranking uses the conservative upper bound, {input.upper_bound.toFixed(4)}%.</>}
      <div><a href={input.source_url} target="_blank" rel="noreferrer">{input.metric === 'rent_usd' ? 'City / ACS source' : 'FEMA source'}</a> · {input.source_period}</div>
      <p>{input.limitation}</p>
    </li>)}</ul>
    <p>These bounds can lower a neighborhood’s ranking compared with its unknown exact value. Original missing observations remain unknown.</p>
  </aside>;
}
