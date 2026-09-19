import { useEffect, useRef, useState } from 'react';
import type { ReportConfig } from '../App';
import { Card, Segmented } from '../components/Bits';
import { DEFAULT_WEIGHTS, OFFICES, WEIGHT_DEFS } from '../data/offices';
import { CONNECTORS, type ConnectorId, type ConnectorStates } from '../data/connectors';
import { ACCEPTED, readTranscriptFile, TranscriptFileError } from '../data/transcriptFile';
import {
  LIFESTYLE_FIELDS,
  OFFER_FIELDS,
  PROFILE_CONFIDENCE,
  TRANSCRIPT,
} from '../data/profile';
import type { Confidence, ProfileField, WeightId } from '../types';

const STEPS: Array<[number, string]> = [
  [1, 'Conversation'],
  [2, 'Profile'],
  [3, 'Configure'],
];

const GENERATE_LABELS = [
  'Scoring neighborhoods with your weights…',
  'Estimating take-home and housing…',
  'Checking flood and city-service data…',
  'Writing the candidate narrative…',
];

function ConfidenceDots({ level }: { level: Confidence }) {
  return (
    <span className="conf" data-level={level} title={`${level} confidence`}>
      <span className="conf-dot" />
      <span className="conf-dot" />
      <span className="conf-dot" />
      {level}
    </span>
  );
}

export default function CreateReport({
  config,
  onChange,
  connectors,
  onOpenConnectors,
  onGenerated,
}: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
  connectors: ConnectorStates;
  onOpenConnectors: () => void;
  onGenerated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [importing, setImporting] = useState<ConnectorId | null>(null);
  const [transcript, setTranscript] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [genLabel, setGenLabel] = useState('');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const track = (id: number) => timers.current.push(id);

  const setProfileField = (field: ProfileField, value: string) =>
    onChange({ ...config, profile: { ...config.profile, [field]: value } });

  const setWeight = (id: WeightId, value: number) =>
    onChange({ ...config, weights: { ...config.weights, [id]: value } });

  /** Only connected sources reach this screen, so this is always an import. */
  function importFrom(id: ConnectorId) {
    if (importing) return;
    setImporting(id);
    track(
      window.setTimeout(() => {
        setImporting(null);
        setTranscript(TRANSCRIPT);
      }, 1400),
    );
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    event.target.value = '';
    if (!file) return;

    setUploadError(null);
    try {
      const text = await readTranscriptFile(file);
      setTranscript(text);
      setUploadName(file.name);
      setImporting(null);
    } catch (err) {
      setTranscript('');
      setUploadName(null);
      setUploadError(
        err instanceof TranscriptFileError ? err.message : 'That file could not be read.',
      );
    }
  }

  function extract() {
    setExtracting(true);
    track(
      window.setTimeout(() => {
        setExtracting(false);
        setStep(2);
      }, 1200),
    );
  }

  function generate() {
    setGenerating(true);
    setProgress(8);
    setGenLabel(GENERATE_LABELS[0]);
    GENERATE_LABELS.slice(1).forEach((label, i) => {
      track(
        window.setTimeout(
          () => {
            setProgress(8 + (i + 1) * 28);
            setGenLabel(label);
          },
          650 * (i + 1),
        ),
      );
    });
    track(
      window.setTimeout(() => {
        setProgress(100);
        setGenerating(false);
        onGenerated();
      }, 650 * GENERATE_LABELS.length),
    );
  }

  const connected = CONNECTORS.filter((c) => connectors[c.id] === 'connected');
  const importingName = CONNECTORS.find((c) => c.id === importing)?.name ?? '';
  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0) || 1;
  const transcriptLines = transcript
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, 6)
    .map((line) => {
      const [who, ...rest] = line.split(': ');
      return { who, text: rest.join(': ') };
    });

  return (
    <main className="create">
      <div className="shell">
        <div className="steps">
          {STEPS.map(([num, label], i) => {
            const state = num < step ? 'done' : num === step ? 'current' : 'todo';
            return (
              <div key={num} style={{ display: 'contents' }}>
                <button
                  type="button"
                  className="step"
                  data-state={state}
                  onClick={() => {
                    if (num <= step || transcript) setStep(num);
                  }}
                >
                  <span className="step-num">{num < step ? '✓' : num}</span>
                  {label}
                </button>
                {i < STEPS.length - 1 ? <span className="step-rule" /> : null}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <>
            <h1 className="section-title">Start from the conversation</h1>
            <p className="section-lede">
              Import the recruiter call from a meeting-notes tool, or paste the transcript. The
              lifestyle detail that makes a report specific comes from what the candidate actually
              said, not from a form.
            </p>

            {connected.length > 0 ? (
              <div className="connectors">
                {connected.map((c) => {
                  const busy = importing === c.id;
                  return (
                    <Card key={c.id}>
                      <button
                        type="button"
                        className="connector"
                        onClick={() => importFrom(c.id)}
                        disabled={Boolean(importing)}
                      >
                        <span className="connector-mark" aria-hidden="true">
                          {c.mark}
                        </span>
                        <span>
                          <span className="connector-name">{c.name}</span>
                          <br />
                          <span className="connector-state" data-connected="true">
                            {busy ? 'Importing…' : 'Import notes'}
                          </span>
                        </span>
                      </button>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <div className="empty" style={{ padding: '28px 18px' }}>
                  No sources are connected yet.
                  <br />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: 14 }}
                    onClick={onOpenConnectors}
                  >
                    Go to Connectors
                  </button>
                </div>
              </Card>
            )}

            <div style={{ height: 20 }} />

            <Card>
              <div className="sec-head" style={{ marginBottom: 12 }}>
                <span className="eyebrow">
                  Transcript
                  {uploadName ? <span className="upload-name"> · {uploadName}</span> : null}
                </span>
                <button
                  type="button"
                  className="pill"
                  onClick={() => fileInput.current?.click()}
                >
                  Upload transcript
                </button>
              </div>

              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED}
                onChange={onFile}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />

              {uploadError ? <div className="form-error">{uploadError}</div> : null}

              {importing ? (
                <p className="line-text">
                  <span className="spinner" />
                  Importing notes from {importingName}…
                </p>
              ) : transcript ? (
                <>
                  <div className="transcript">
                    {transcriptLines.map((l, i) => (
                      <div key={i}>
                        <div className="line-who" data-who={l.who}>
                          {l.who}
                        </div>
                        <div className="line-text">{l.text}</div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn btn-primary" onClick={extract} disabled={extracting}>
                    {extracting ? (
                      <>
                        <span className="spinner" />
                        Extracting preferences…
                      </>
                    ) : (
                      'Extract preferences →'
                    )}
                  </button>
                </>
              ) : (
                <>
                  <label className="field" style={{ display: 'block' }}>
                    <textarea
                      rows={6}
                      placeholder="Paste the recruiter call transcript, upload a file, or import it above."
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                    />
                  </label>
                  <div style={{ height: 12 }} />
                  <p className="source">
                    Accepts .txt, .md, .vtt and .srt up to 2 MB. Uploaded files are read in
                    your browser and never sent anywhere. Nothing is stored until you generate.
                  </p>
                </>
              )}
            </Card>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="section-title">Check what we pulled out</h1>
            <p className="section-lede">
              Extraction is a starting point, not a source of truth. Each field carries a confidence
              so you can see where to look first. Edit anything before it reaches the candidate.
            </p>

            <span className="eyebrow">Offer and role</span>
            <div style={{ height: 10 }} />
            <div className="fields">
              {OFFER_FIELDS.map(([id, label]) => (
                <div className="field" key={id}>
                  <label htmlFor={`f-${id}`}>
                    {label}
                    <ConfidenceDots level={PROFILE_CONFIDENCE[id]} />
                  </label>
                  <input
                    id={`f-${id}`}
                    value={config.profile[id]}
                    onChange={(e) => setProfileField(id, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <span className="eyebrow">Life outside work</span>
            <div style={{ height: 10 }} />
            <div className="fields">
              {LIFESTYLE_FIELDS.map(([id, label]) => (
                <div className="field" key={id}>
                  <label htmlFor={`f-${id}`}>
                    {label}
                    <ConfidenceDots level={PROFILE_CONFIDENCE[id]} />
                  </label>
                  <textarea
                    id={`f-${id}`}
                    rows={2}
                    value={config.profile[id]}
                    onChange={(e) => setProfileField(id, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>
              Configure the report →
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="section-title">Configure and generate</h1>
            <p className="section-lede">
              Weights decide how the neighborhoods are ranked, and the report shows the candidate
              which ones you set. Safety is reported as a tier on each area and is deliberately not
              a slider.
            </p>

            <div className="config-grid">
              <Card>
                <div className="field-row">
                  <span className="eyebrow">Comparison</span>
                  <Segmented
                    label="Comparison mode"
                    value={config.mode}
                    onChange={(mode) => onChange({ ...config, mode })}
                    options={[
                      { id: 'offer', label: 'Offer mode' },
                      { id: 'remote', label: 'Remote mode' },
                    ]}
                  />
                </div>
                <div className="field-row">
                  <span className="eyebrow">Housing</span>
                  <Segmented
                    label="Housing"
                    value={config.tenure}
                    onChange={(tenure) => onChange({ ...config, tenure })}
                    options={[
                      { id: 'rent', label: 'Rent' },
                      { id: 'buy', label: 'Buy' },
                    ]}
                  />
                </div>
                <div className="field-row" style={{ marginBottom: 0 }}>
                  <span className="eyebrow">Office hub</span>
                  <div className="offices">
                    {OFFICES.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="office"
                        aria-pressed={config.office === o.id}
                        onClick={() => onChange({ ...config, office: o.id })}
                      >
                        <span className="office-label">{o.label}</span>
                        <br />
                        <span className="office-sub">{o.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </Card>

              <Card>
                <div className="sec-head">
                  <span className="eyebrow">Priority weights</span>
                  <button
                    type="button"
                    className="pill"
                    onClick={() => onChange({ ...config, weights: DEFAULT_WEIGHTS })}
                  >
                    Reset
                  </button>
                </div>
                <div style={{ height: 12 }} />
                {WEIGHT_DEFS.map((w) => (
                  <div className="weight" key={w.id}>
                    <div className="weight-head">
                      <label htmlFor={`w-${w.id}`}>{w.label}</label>
                      <span className="weight-pct">
                        {Math.round((config.weights[w.id] / totalWeight) * 100)}%
                      </span>
                    </div>
                    <input
                      id={`w-${w.id}`}
                      type="range"
                      min={0}
                      max={10}
                      value={config.weights[w.id]}
                      onChange={(e) => setWeight(w.id, Number(e.target.value))}
                    />
                  </div>
                ))}
              </Card>
            </div>

            {generating ? (
              <Card>
                <div className="progress">
                  <div style={{ width: `${progress}%` }} />
                </div>
                <p className="line-text">{genLabel}</p>
              </Card>
            ) : (
              <button type="button" className="btn btn-primary" onClick={generate}>
                Generate report
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
