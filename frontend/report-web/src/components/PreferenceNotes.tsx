import { useRef, useState } from 'react';
import type { CandidateProfile } from '../types';
import { OFFER_FIELDS, LIFESTYLE_FIELDS } from '../data/profile';
import { extractProfile, type ExtractionResult } from '../data/reportFlow';
import { Card } from './Bits';

export default function PreferenceNotes({ profile, onChange, onBusy }: {
  profile: CandidateProfile; onChange: (next: CandidateProfile) => void; onBusy: (busy: boolean) => void;
}) {
  const [notes, setNotes] = useState('');
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function extract() {
    if (pending.current || !notes.trim()) return;
    pending.current = true; setBusy(true); onBusy(true); setError('');
    try {
      const result = await extractProfile(notes, profile);
      setExtraction(result);
      const reviewed = { ...profile };
      for (const key of Object.keys(profile) as Array<keyof CandidateProfile>) reviewed[key] = result.data.fields[key]?.value ?? '';
      onChange(reviewed);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Please enter your answers manually.'); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  }
  return <Card className="preference-notes">
    <h2 className="section-title">Start with your notes</h2>
    <p className="source">Optional: paste your relocation preferences and we’ll organize them for review. Notes and reviewed answers are sent to our AI provider when you use AI. They are not saved as a report.</p>
    <label className="login-label" htmlFor="preference-notes">Relocation notes</label>
    <textarea id="preference-notes" rows={4} maxLength={24000} value={notes} disabled={busy}
      placeholder="For example: I work near Midtown, enjoy parks, and fly from Hobby regularly."
      onChange={event => { setNotes(event.target.value); setExtraction(null); }} />
    <button type="button" className="btn" disabled={busy || !notes.trim()} onClick={() => { void extract(); }}>
      {busy ? 'Organizing your notes…' : 'Extract preferences'}
    </button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {extraction && <p role="status" className="source">{extraction.status === 'generated'
      ? 'Review and edit the extracted answers below. Your existing answers were kept.'
      : 'AI extraction is unavailable. Your existing answers were kept; fill in the rest manually.'}</p>}
    <details open={Boolean(extraction)}>
      <summary>Review or enter your preferences</summary>
      <p className="source">These answers give the explanation context. Use the controls below to set the actual ranking priorities; notes do not change scores automatically.</p>
      <div className="profile-review">{[...OFFER_FIELDS, ...LIFESTYLE_FIELDS].map(([id, label]) => <div key={id} className="login-label">
        <label htmlFor={`profile-${id}`}>{label}</label><input id={`profile-${id}`} value={profile[id]} maxLength={500} disabled={busy}
          aria-describedby={extraction?.data.fields[id]?.evidence ? `quote-${id}` : undefined}
          onChange={event => onChange({ ...profile, [id]: event.target.value })} />
        {extraction?.data.fields[id]?.evidence && <span id={`quote-${id}`} className="source">From your notes: “{extraction.data.fields[id].evidence}”</span>}
      </div>)}</div>
    </details>
  </Card>;
}
