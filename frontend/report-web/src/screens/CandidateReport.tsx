import { useMemo, useState } from 'react';
import type { ReportConfig } from '../App';
import { Card, Source } from '../components/Bits';
import { OFFICES, WEIGHT_DEFS } from '../data/offices';
import { MOCK_REPORT } from '../data/report';
import type { Neighborhood, Report } from '../types';

/**
 * Renders a `Report`. The only thing it takes from the recruiter's config is
 * the office hub, the weight summary and the mode, because those are the parts
 * the prototype can honestly recompute without a backend. Everything else is
 * served from the mock until `GET /reports/:id` exists.
 */
function useReport(config: ReportConfig): Report {
  return useMemo(() => {
    const officeName = OFFICES.find((o) => o.id === config.office)?.label ?? MOCK_REPORT.officeName;
    const offerFact = config.mode === 'remote'
      ? `${config.profile.salary} (remote scenario)`
      : config.profile.offer;

    return {
      ...MOCK_REPORT,
      officeName,
      mode: config.mode,
      tenure: config.tenure,
      weights: config.weights,
      hero: {
        ...MOCK_REPORT.hero,
        facts: [
          { label: 'Role', value: config.profile.role },
          { label: 'Moving from', value: config.profile.city },
          { label: 'Houston offer', value: offerFact },
          { label: 'Office hub', value: officeName },
        ],
      },
    };
  }, [config]);
}

function NeighborhoodCard({ hood, rank }: { hood: Neighborhood; rank: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="hood-head">
        <div>
          <div className="hood-rank">#{rank} match</div>
          <h3 className="hood-name">{hood.name}</h3>
        </div>
        <div className="hood-score">
          {hood.score}
          <span> / 100</span>
        </div>
      </div>

      <div className="tags">
        <span className="tag">
          {hood.commute} · {hood.commuteMode}
        </span>
        <span className="tag" data-afford={hood.affordLevel}>
          {hood.afford}
        </span>
        <span className="tag">{hood.rent}</span>
        <span className="tag" data-flood={hood.flood}>
          Flood: {hood.flood}
        </span>
        <span className="tag">City services: {hood.services}</span>
        <span className="tag">{hood.momentum}</span>
      </div>

      <p className="hood-why">{hood.why}</p>

      <p className="source" style={{ marginTop: 10 }}>
        Reported crime is {hood.safety} the city median per 1,000 residents. Tiers only, from the
        HPD NIBRS summary — not a ranking, and not a judgement about the people who live there.
      </p>

      <button type="button" className="disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '−' : '+'} Why this ranked here
      </button>

      {open ? (
        <div className="factors">
          {hood.factors.map((f) => (
            <div key={f.label}>
              <div className="factor-head">
                <span>{f.label}</span>
                <span className="factor-note">{f.note}</span>
              </div>
              <div className="factor-track">
                <div className="factor-fill" style={{ width: `${f.weight}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export default function CandidateReport({
  config,
  onToast,
}: {
  config: ReportConfig;
  onToast: (message: string) => void;
}) {
  const report = useReport(config);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);

  const weightSummary = [...WEIGHT_DEFS]
    .sort((a, b) => report.weights[b.id] - report.weights[a.id])
    .slice(0, 3)
    .map((w) => w.label.toLowerCase())
    .join(', ');

  const pins = [
    { label: report.officeName.split(' /')[0], x: '56%', y: '58%', size: 10, office: true },
    ...report.neighborhoods.map((n) => ({
      label: n.name,
      x: n.x,
      y: n.y,
      size: n.score / 6,
      office: false,
    })),
  ];

  function submitLead(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !consent) {
      setError(true);
      return;
    }
    setError(false);
    setSubmitted(true);
  }

  return (
    <>
      <div className="report-bar">
        <span className="wordmark">
          Someone&rsquo;s <em>Houston</em>
        </span>
        <span className="source">Data as of {report.dataAsOf}</span>
        <button type="button" className="btn" onClick={() => onToast('Link copied to clipboard')}>
          Share
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          Print / PDF
        </button>
      </div>

      <main className="report-body">
        <section className="hero">
          <span className="eyebrow">Your Someone&rsquo;s Houston</span>
          <h1>
            {report.hero.headline} <em>{report.hero.headlineEmphasis}</em> in Houston.
          </h1>
          <p>{report.hero.intro}</p>

          <div className="facts">
            {report.hero.facts.map((f) => (
              <Card key={f.label}>
                <div className="fact-label">{f.label}</div>
                <div className="fact-value">{f.value}</div>
              </Card>
            ))}
          </div>

          <div className="notes">
            <Card>
              <div className="note-title">{report.hero.careerTitle}</div>
              <p className="note-text">{report.hero.careerText}</p>
            </Card>
            <Card>
              <div className="note-title">{report.hero.howToReadTitle}</div>
              <p className="note-text">{report.hero.howToReadText}</p>
            </Card>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <h2 className="section-title">Financial comparison</h2>
            <button
              type="button"
              className="pill"
              onClick={() => setShowAssumptions(!showAssumptions)}
              aria-expanded={showAssumptions}
            >
              {showAssumptions ? 'Hide assumptions' : 'See assumptions'}
            </button>
          </div>
          <p className="section-lede">{report.financial.summary}</p>

          {showAssumptions ? (
            <Card>
              <span className="eyebrow">Assumptions</span>
              <p className="note-text" style={{ marginTop: 8 }}>
                {report.financial.assumptions}
              </p>
            </Card>
          ) : null}

          <div className="fin-rows">
            {report.financial.rows.map((row) => (
              <Card key={row.label}>
                <div className="fin-head">
                  <span className="fin-label">{row.label}</span>
                  <span className="fin-delta" data-dir={row.direction}>
                    {row.delta}
                  </span>
                </div>

                <div className="bar-row">
                  <span className="bar-city">{report.originCity}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${row.originWidth}%` }} />
                  </span>
                  <span className="bar-value">{row.origin}</span>
                </div>
                <div className="bar-row">
                  <span className="bar-city">Houston</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill"
                      data-houston="true"
                      style={{ width: `${row.houstonWidth}%` }}
                    />
                  </span>
                  <span className="bar-value">{row.houston}</span>
                </div>

                <p className="fin-note">{row.note}</p>
                <Source>{row.source}</Source>
              </Card>
            ))}
          </div>

          <div className="callout">
            <strong>Property-tax note.</strong> {report.financial.propertyTaxNote}
          </div>
        </section>

        <section>
          <h2 className="section-title">Top neighborhood matches</h2>
          <p className="section-lede">
            Ranked with your weights: {weightSummary}. Commutes are to {report.officeName}. Scores
            compare these areas against each other, not against a fixed standard.
          </p>

          <div className="map" role="img" aria-label="Abstract map of the recommended areas relative to the office">
            <span className="map-note">ABSTRACT · NOT TO SCALE</span>
            {pins.map((p) => (
              <span
                key={p.label}
                className="pin"
                data-office={p.office}
                style={{ left: p.x, top: p.y }}
              >
                <span className="pin-dot" style={{ width: p.size, height: p.size }} />
                {p.label}
              </span>
            ))}
          </div>

          <div className="hoods">
            {report.neighborhoods.map((hood, i) => (
              <NeighborhoodCard key={hood.id} hood={hood} rank={i + 1} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title">How the week actually works</h2>
          <p className="section-lede">
            Built from what you told your recruiter, not from a generic city profile.
          </p>
          <div className="life">
            {report.lifestyle.map((card) => (
              <Card key={card.eyebrow} className={card.feature ? 'life-card life-card-feature' : 'life-card'}>
                <div className="life-top">
                  <span className="eyebrow">{card.eyebrow}</span>
                  <span className="life-tag">{card.tag}</span>
                </div>
                <h3 className="life-title">{card.title}</h3>
                <p className="life-text">{card.text}</p>
                <div className="chips">
                  {card.chips.map((c) => (
                    <span className="chip" key={c}>
                      {c}
                    </span>
                  ))}
                </div>
                <Source>{card.source}</Source>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title">What to consider</h2>
          <p className="section-lede">
            None of these are deal-breakers on their own. They are the things worth pricing in
            before deciding.
          </p>
          <div className="considerations">
            {report.considerations.map((c) => (
              <div className="consideration" key={c.title}>
                <span className="consideration-dot" aria-hidden="true" />
                <div>
                  <div className="note-title">{c.title}</div>
                  <div className="note-text">{c.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="cta">
            <div>
              <span className="eyebrow">Optional next step</span>
              <h2 className="section-title" style={{ marginTop: 8 }}>
                Talk to a Houston relocation expert
              </h2>
              <p className="section-lede" style={{ marginBottom: 0 }}>
                A local expert can walk through neighborhoods, flood maps, and housing with you and
                your partner. This is opt-in. Your contact details are shared only after you consent
                below, and you can decline without affecting your offer.
              </p>
            </div>

            <Card>
              {submitted ? (
                <>
                  <div className="confirm-mark" aria-hidden="true">
                    ✓
                  </div>
                  <div className="note-title">Request sent</div>
                  <p className="note-text">
                    An expert will reach out to {email} within two business days. You can withdraw
                    consent at any time from the link in that email.
                  </p>
                </>
              ) : (
                <form onSubmit={submitLead} noValidate>
                  <div className="field">
                    <label htmlFor="lead-email">Preferred email</label>
                    <input
                      id="lead-email"
                      type="email"
                      value={email}
                      placeholder="you@example.com"
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I consent to Someone&rsquo;s Houston sharing my name, this report, and my email
                    with one vetted Houston relocation expert.
                  </label>
                  {error ? (
                    <div className="form-error">
                      Add an email and tick the consent box to continue.
                    </div>
                  ) : null}
                  <button type="submit" className="btn btn-primary">
                    Request an introduction
                  </button>
                </form>
              )}
            </Card>
          </div>

          <div className="report-actions">
            <button type="button" className="btn" onClick={() => onToast('Link copied to clipboard')}>
              Share this report
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              Print / PDF
            </button>
          </div>
        </section>

        <footer className="report-footer">
          <span className="eyebrow">Sources and transparency</span>
          {report.sources.join(' · ')}
          <p style={{ marginTop: 10 }}>{report.disclaimer}</p>
        </footer>
      </main>
    </>
  );
}
