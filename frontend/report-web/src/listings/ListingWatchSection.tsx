import { useCallback, useEffect, useState } from 'react';
import { Card, Segmented } from '../components/Bits';
import { fetchListings, ListingsError, type ListingType } from './api';
import { formatUsd, outsideHouston, type Listing } from './listing';

/**
 * Current listings in the candidate's neighborhoods.
 *
 * Distinct from the weekly digest the Listing Watch button sets up: this is
 * what is on the market right now. Neither is a recommendation — these come
 * straight from the search, unranked and unscored.
 */
export default function ListingWatchSection({
  onOpenWatch,
  watchEnabled,
}: {
  onOpenWatch: () => void;
  watchEnabled: boolean;
}) {
  const [type, setType] = useState<ListingType>('sale');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<ListingsError | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (which: ListingType) => {
    setLoading(true);
    setError(null);
    try {
      setListings(await fetchListings(which));
    } catch (err) {
      setListings(null);
      setError(
        err instanceof ListingsError
          ? err
          : new ListingsError('Listings could not be read.', 'unavailable'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(type);
    setShowAll(false);
  }, [type, load]);

  const strays = listings?.filter(outsideHouston).length ?? 0;
  const shown = showAll ? listings : listings?.slice(0, 6);

  return (
    <section>
      <div className="sec-head">
        <h2 className="section-title">On the market now</h2>
        <Segmented
          label="Listing type"
          value={type}
          onChange={setType}
          options={[
            { id: 'sale', label: 'For sale' },
            { id: 'rent', label: 'To rent' },
          ]}
        />
      </div>

      <p className="section-lede">
        What is listed today, straight from the saved search. These are not ranked or
        scored against your preferences, and they carry none of the city-data checks
        above — they are here so you can see real prices next to the estimates.
        {watchEnabled ? ' For a weekly digest instead, start a Listing Watch.' : ''}
      </p>

      {strays > 0 ? (
        <Card style={{ borderColor: 'rgba(245,158,11,.35)', background: 'rgba(245,158,11,.08)' }}>
          <span className="eyebrow" style={{ color: 'var(--amber)' }}>
            Check the saved search
          </span>
          <p className="note-text" style={{ marginTop: 8 }}>
            {strays} of {listings?.length} listings fall outside the Houston area.
          </p>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <p className="line-text">
            <span className="spinner" />
            Loading listings…
          </p>
        </Card>
      ) : error ? (
        <Card>
          <span className="eyebrow">
            {error.kind === 'no_run' ? 'Nothing listed yet' : 'Listings unavailable'}
          </span>
          <p className="note-text" style={{ margin: '8px 0 12px' }}>
            {error.kind === 'unconfigured'
              ? 'The listings service is not connected to this build, so nothing is shown here.'
              : error.message}
          </p>
          {error.kind === 'unavailable' ? (
            <button type="button" className="btn" onClick={() => void load(type)}>
              Try again
            </button>
          ) : null}
        </Card>
      ) : shown && shown.length > 0 ? (
        <>
          <div className="lst-grid">
            {shown.map((l) => (
              <Card key={l.key} className="lst-card">
                {l.imageUrl ? (
                  <img className="lst-photo" src={l.imageUrl} alt="" loading="lazy" />
                ) : (
                  <div className="lst-photo lst-photo-empty">No photo</div>
                )}
                <div className="lst-body">
                  <div className="lst-price">
                    {l.priceLabel ?? formatUsd(l.price) ?? (
                      <span className="lst-unknown">Price unavailable</span>
                    )}
                  </div>
                  <div className="lst-address">
                    {l.address ?? <span className="lst-unknown">Address unavailable</span>}
                  </div>
                  <div className="lst-meta">
                    {[
                      l.beds !== null ? `${l.beds} bd` : null,
                      l.baths !== null ? `${l.baths} ba` : null,
                      l.area !== null
                        ? `${l.area.toLocaleString('en-US')} ${l.areaUnit ?? 'sqft'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Details unavailable'}
                  </div>
                  <div className="lst-sub">
                    {[
                      l.homeType,
                      l.daysOnZillow !== null
                        ? l.daysOnZillow === 0
                          ? 'New today'
                          : `${l.daysOnZillow} day${l.daysOnZillow === 1 ? '' : 's'} listed`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {outsideHouston(l) ? (
                    <div className="lst-stray">Outside the Houston area</div>
                  ) : null}
                  {l.detailUrl ? (
                    <a
                      className="lst-link"
                      href={l.detailUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      View on Zillow →
                    </a>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>

          <div className="report-actions">
            {listings && listings.length > 6 ? (
              <button type="button" className="btn" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${listings.length}`}
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={onOpenWatch}>
              Watch these weekly
            </button>
          </div>

          <p className="source" style={{ marginTop: 14 }}>
            Source: saved Zillow search, via the Houston Watch service. Listing data belongs
            to its publisher and is shown for comparison, not as an offer.
          </p>
        </>
      ) : (
        <Card>
          <div className="empty">The last run returned no listings.</div>
        </Card>
      )}
    </section>
  );
}
