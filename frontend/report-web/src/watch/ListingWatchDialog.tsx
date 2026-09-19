import { useEffect, useRef, useState } from 'react';
import { hasListingWatch } from '../config';
import { Segmented } from '../components/Bits';
import { createWatch, WatchError } from './api';
import { WATCH_EXPIRY_WEEKS, type ListingType } from './types';

interface Pick {
  neighborhoodId: number;
  name: string;
}

/**
 * Sets up a Listing Watch: a weekly server-side check for new listings and
 * price drops in the candidate's chosen neighborhoods.
 *
 * Opt-in only, matching the expert-introduction CTA. Nothing is sent until an
 * email is given and the consent box is ticked, and the submit button stays
 * disabled until both are true so the commitment is visible before it is made.
 */
export default function ListingWatchDialog({
  open,
  onClose,
  reportId,
  picks,
  officeId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  reportId: string;
  picks: Pick[];
  officeId: string;
  onDone: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<number[]>(picks.map((p) => p.neighborhoodId));
  const [listingType, setListingType] = useState<ListingType>('both');
  const [soft, setSoft] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(picks.map((p) => p.neighborhoodId));
  }, [picks]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const ready = email.trim().length > 0 && consent && selected.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createWatch({
        reportId,
        neighborhoodIds: selected,
        neighborhoodNames: picks
          .filter((p) => selected.includes(p.neighborhoodId))
          .map((p) => p.name),
        listingType,
        softCriteria: soft.trim(),
        officeId,
        delivery: { channel: 'email', email: email.trim() },
        consent: true,
        cadence: 'weekly',
        expiresAfterWeeks: WATCH_EXPIRY_WEEKS,
      });
      onDone('Listing watch created — first digest Monday');
      onClose();
    } catch (err) {
      setError(
        err instanceof WatchError
          ? err.kind === 'unconfigured'
            ? 'The listing watch service is not connected to this build yet, so nothing was sent.'
            : err.message
          : 'Something went wrong. Nothing was sent.',
      );
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <dialog ref={ref} className="watch-dialog" onCancel={onClose} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="watch-head">
          <div>
            <span className="eyebrow">Listing Watch</span>
            <h2 className="section-title" style={{ marginTop: 6 }}>
              Watch these neighborhoods weekly
            </h2>
          </div>
          <button type="button" className="pill" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="section-lede">
          Every Monday we check for new listings and price drops in the neighborhoods you
          pick, and email you a short digest. Each listing carries the City of Houston
          checks a listing site does not show — mapped floodplain, nearby 311 flooding
          complaints, and permit activity. If nothing new fits, we send nothing.
        </p>

        <div className="field-row">
          <span className="eyebrow">Neighborhoods</span>
          <div className="watch-hoods">
            {picks.map((p) => (
              <label key={p.neighborhoodId} className="watch-check">
                <input
                  type="checkbox"
                  checked={selected.includes(p.neighborhoodId)}
                  onChange={() => toggle(p.neighborhoodId)}
                />
                {p.name}
              </label>
            ))}
          </div>
          {selected.length === 0 ? (
            <div className="form-error">Pick at least one neighborhood.</div>
          ) : null}
        </div>

        <div className="field-row">
          <span className="eyebrow">Listings</span>
          <Segmented
            label="Listing type"
            value={listingType}
            onChange={setListingType}
            options={[
              { id: 'both', label: 'Both' },
              { id: 'sale', label: 'For sale' },
              { id: 'rent', label: 'To rent' },
            ]}
          />
        </div>

        <div className="field">
          <label htmlFor="watch-soft">What matters in a home? (optional)</label>
          <textarea
            id="watch-soft"
            rows={2}
            value={soft}
            placeholder="Good light, room for a home office, happy to do light renovation"
            onChange={(e) => setSoft(e.target.value)}
          />
          <p className="source" style={{ marginTop: 6 }}>
            Used to rank the property itself — light, layout, condition, space. Never the
            people or character of an area.
          </p>
        </div>

        <div className="field">
          <label htmlFor="watch-email">Where to send it</label>
          <input
            id="watch-email"
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
          I want a weekly listing digest at this address. It stops automatically after{' '}
          {WATCH_EXPIRY_WEEKS} weeks, every email has a one-click stop link, and my address
          is deleted when the watch ends.
        </label>

        {!hasListingWatch ? (
          <p className="source" style={{ marginBottom: 10 }}>
            Not connected in this build — submitting will tell you so rather than silently
            failing.
          </p>
        ) : null}

        {error ? <div className="form-error">{error}</div> : null}

        <div className="watch-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            {busy ? (
              <>
                <span className="spinner" />
                Creating…
              </>
            ) : (
              'Start weekly watch'
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
