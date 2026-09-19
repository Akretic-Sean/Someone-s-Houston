import { useMemo, useState } from 'react';
import type { ReportConfig } from '../App';
import { Card, Source } from '../components/Bits';
import NeighborhoodMap from '../components/NeighborhoodMap';
import { OFFICES, WEIGHT_DEFS } from '../data/offices';
import { MOCK_REPORT } from '../data/report';
import { sourceLabel } from '../data/neighborhoodApi';
import { formatRent, resolveNeighborhoods } from '../data/resolve';
import { useNeighborhoods } from '../hooks/useNeighborhoods';
import EvidenceCards from '../evidence/EvidenceCards';
import { useEvidence } from '../evidence/useEvidence';
import { buildCategoryViews, findDestination } from '../evidence/select';
import ListingWatchDialog from '../watch/ListingWatchDialog';
import ListingWatchSection from '../listings/ListingWatchSection';
import { hasListingWatch } from '../config';
import type { Report, ResolvedNeighborhood } from '../types';

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

function NeighborhoodCard({
  hood,
  rank,
  hovered,
  onHover,
}: {
  hood: ResolvedNeighborhood;
  rank: number;
  hovered: string | null;
  onHover: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card
      className={hovered === hood.id ? 'hood-card hood-card-active' : 'hood-card'}
      onMouseEnter={() => onHover(hood.id)}
      onMouseLeave={() => onHover(null)}
    >
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
        <span className="tag">{formatRent(hood.medianGrossRent)}</span>
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
  const { rows, loading, error, retry } = useNeighborhoods();
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [leadError, setLeadError] = useState(false);

  const weightSummary = [...WEIGHT_DEFS]
    .sort((a, b) => report.weights[b.id] - report.weights[a.id])
    .slice(0, 3)
    .map((w) => w.label.toLowerCase())
    .join(', ');

  const office = OFFICES.find((o) => o.id === config.office) ?? OFFICES[0];
  const resolved = rows ? resolveNeighborhoods(report.neighborhoods, rows) : [];
  const activeId = selectedId ?? resolved[0]?.neighborhoodId ?? null;
  const evidence = useEvidence(activeId);
  const activeName = resolved.find((n) => n.neighborhoodId === activeId)?.name ?? '';
  const categoryViews = evidence.payload ? buildCategoryViews(evidence.payload) : [];

  // The office marker must sit on the point the displayed distance was measured
  // from, which is the evidence destination, not the frontend's own constant.
  const evidenceOffice = findDestination(
    evidence.payload?.neighborhoods[0]?.categories?.commute ?? null,
    config.office,
  );
  const officeForMap =
    evidenceOffice?.coordinates
      ? { ...office, lon: evidenceOffice.coordinates[0], lat: evidenceOffice.coordinates[1] }
      : office;

  function submitLead(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !consent) {
      setLeadError(true);
      return;
    }
    setLeadError(false);
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setWatchOpen(true)}
          disabled={resolved.length === 0}
          title={
            resolved.length === 0
              ? 'Available once the neighborhood data has loaded'
              : undefined
          }
        >
          Listing Watch
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

          {loading ? (
            <Card>
              <p className="line-text">
                <span className="spinner" />
                Loading City of Houston neighborhood data…
              </p>
            </Card>
          ) : error ? (
            <Card>
              <span className="eyebrow">Neighborhood data unavailable</span>
              <p className="note-text" style={{ margin: '8px 0 12px' }}>
                {error.kind === 'auth'
                  ? 'The neighborhood data layer is not configured for this build, so the map and the figures that depend on it are not shown. Nothing here has been estimated in its place.'
                  : 'The City of Houston neighborhood data could not be read just now. Nothing has been estimated in its place.'}
              </p>
              {error.kind === 'unavailable' ? (
                <button type="button" className="btn" onClick={retry}>
                  Try again
                </button>
              ) : null}
            </Card>
          ) : (
            <>
              <NeighborhoodMap
                rows={rows ?? []}
                picks={resolved}
                office={officeForMap}
                hovered={hovered}
                onHover={setHovered}
                sourceLabel={sourceLabel(rows ?? [])}
              />

              <div className="hoods">
                {resolved.map((hood, i) => (
                  <NeighborhoodCard
                    key={hood.id}
                    hood={hood}
                    rank={i + 1}
                    hovered={hovered}
                    onHover={setHovered}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <section>
          <div className="sec-head">
            <h2 className="section-title">The evidence</h2>
            {resolved.length > 0 ? (
              <div className="seg" role="group" aria-label="Neighborhood">
                {resolved.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    aria-pressed={n.neighborhoodId === activeId}
                    onClick={() => setSelectedId(n.neighborhoodId)}
                  >
                    {n.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="section-lede">
            What the published data actually supports for {activeName || 'this area'}, category
            by category, with the source under each figure. Anything not published is marked
            unavailable rather than estimated. There are no category scores and no safety tier:
            the backend returns neither.
          </p>

          {evidence.loading ? (
            <Card>
              <p className="line-text">
                <span className="spinner" />
                Loading evidence…
              </p>
            </Card>
          ) : evidence.error ? (
            <Card>
              <span className="eyebrow">Evidence unavailable</span>
              <p className="note-text" style={{ margin: '8px 0 12px' }}>
                {evidence.error.kind === 'auth'
                  ? 'The evidence layer is not configured for this build. Nothing has been estimated in its place.'
                  : 'The evidence could not be read just now. Nothing has been estimated in its place.'}
              </p>
              {evidence.error.kind === 'unavailable' ? (
                <button type="button" className="btn" onClick={evidence.retry}>
                  Try again
                </button>
              ) : null}
            </Card>
          ) : categoryViews.length > 0 ? (
            <>
              <EvidenceCards
                views={categoryViews}
                officeId={config.office}
                airportId="iah"
                weights={config.weights}
              />
              {evidence.payload?.interpretation ? (
                <p className="source" style={{ marginTop: 16 }}>
                  {evidence.payload.interpretation}
                </p>
              ) : null}
              <p className="source" style={{ marginTop: 8 }}>
                Safety tier: unavailable
                {evidence.payload?.safety?.reason ? ` — ${evidence.payload.safety.reason}` : ''}
              </p>
            </>
          ) : null}
        </section>

        <ListingWatchSection
          onOpenWatch={() => setWatchOpen(true)}
          watchEnabled={hasListingWatch}
        />

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
                  {leadError ? (
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

      <ListingWatchDialog
        open={watchOpen}
        onClose={() => setWatchOpen(false)}
        reportId={report.id}
        officeId={config.office}
        picks={resolved.map((n) => ({ neighborhoodId: n.neighborhoodId, name: n.name }))}
        onDone={onToast}
      />
    </>
  );
}
