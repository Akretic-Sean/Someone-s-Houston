import { Card } from './Bits';
import {
  DEMO_LISTINGS,
  DEMO_LISTINGS_CAPTURED_AT,
  DEMO_LISTINGS_SOURCE,
  type DemoListing,
} from '../data/demoListings';

/**
 * A captured snapshot of what was on the market in one neighborhood.
 *
 * Deliberately separate from the scored evidence above it: these are listings
 * from a commercial site, not City of Houston data, and they carry none of the
 * flood, facility or affordability checks the report is built on. The heading
 * and footnote say so, because on the page they sit next to figures that are
 * sourced and current.
 */
function meta(listing: DemoListing): string {
  return (
    [
      listing.beds !== null ? `${listing.beds} bd` : null,
      listing.baths ? `${listing.baths} ba` : null,
      listing.area ? `${listing.area.toLocaleString('en-US')} sqft` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Details unavailable'
  );
}

export default function DemoListings({ neighborhoodId }: { neighborhoodId: number | null }) {
  const listings = neighborhoodId === null ? undefined : DEMO_LISTINGS[neighborhoodId];
  if (!listings || listings.length === 0) return null;

  return (
    <Card className="demo-listings">
      <div className="sec-head">
        <span className="eyebrow">On the market · snapshot</span>
        <span className="source">Captured {DEMO_LISTINGS_CAPTURED_AT}</span>
      </div>

      <p className="section-lede" style={{ marginTop: 10 }}>
        What was listed for sale here on the capture date. These are not ranked, not
        scored, and carry none of the City data checks above — they are shown so the
        estimates can be read against real asking prices.
      </p>

      <ul className="demo-listing-grid">
        {listings.map((listing) => (
          <li key={listing.zpid ?? listing.address ?? Math.random()} className="demo-listing">
            {listing.imageUrl ? (
              <img src={listing.imageUrl} alt="" loading="lazy" />
            ) : (
              <div className="demo-listing-nophoto">No photo</div>
            )}
            <div className="demo-listing-body">
              <div className="demo-listing-price">
                {listing.priceLabel ?? (
                  <span className="demo-listing-unknown">Price unavailable</span>
                )}
              </div>
              <div className="demo-listing-address">
                {listing.address ?? (
                  <span className="demo-listing-unknown">Address unavailable</span>
                )}
              </div>
              <div className="demo-listing-meta">{meta(listing)}</div>
              {listing.detailUrl ? (
                <a href={listing.detailUrl} target="_blank" rel="noreferrer noopener">
                  View listing →
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <p className="source" style={{ marginTop: 12 }}>
        Source: {DEMO_LISTINGS_SOURCE}. A one-off capture, frozen at{' '}
        {DEMO_LISTINGS_CAPTURED_AT} — prices and availability will have moved since, and
        nothing here refreshes. Listing data belongs to its publisher and is shown for
        comparison, not as an offer.
      </p>
    </Card>
  );
}
