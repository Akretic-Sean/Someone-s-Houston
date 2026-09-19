import { useEffect, useRef, useState } from 'react';
import type { ReportConfig } from '../App';
import { Card, Segmented } from '../components/Bits';
import { DEFAULT_WEIGHTS, OFFICES, WEIGHT_DEFS } from '../data/offices';
import {
  CONNECTOR_NAMES,
  LIFESTYLE_FIELDS,
  OFFER_FIELDS,
  PROFILE_CONFIDENCE,
  TRANSCRIPT,
  type ConnectorName,
} from '../data/profile';
import type { Confidence, ProfileField, WeightId } from '../types';

type ConnectorState = 'idle' | 'connected';
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

const CONNECTOR_MARK: Record<ConnectorName, string> = {
  Granola: 'G',
  Fireflies: 'Ff',
  Fathom: 'Fa',
  'Zoom Notes': 'Z',
};

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
  onGenerated,
}: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
  onGenerated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [connectors, setConnectors] = useState<Record<ConnectorName, ConnectorState>>({
    Granola: 'connected',
    Fireflies: 'idle',
    Fathom: 'idle',
    'Zoom Notes': 'idle',
  });
  const [importing, setImporting] = useState<ConnectorName | null>(null);
  const [transcript, setTranscript] = useState('');
  const [extracting, setExtracting] = useState(false);
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

  function handleConnector(name: ConnectorName) {
    if (importing) return;
    if (connectors[name] !== 'connected') {
      setConnectors((c) => ({ ...c, [name]: 'connected' }));
      return;
    }
    setImporting(name);
    track(
      window.setTimeout(() => {
        setImporting(null);
        setTranscript(TRANSCRIPT);
      }, 1400),
    );
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

  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0) || 1;
  const transcriptLines = transcript
    .split('\n')
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

            <div className="connectors">
              {CONNECTOR_NAMES.map((name) => {
                const connected = connectors[name] === 'connected';
                const busy = importing === name;
                return (
                  <Card key={name}>
                    <button type="button" className="connector" onClick={() => handleConnector(name)}>
                      <span className="connector-mark" aria-hidden="true">
                        {CONNECTOR_MARK[name]}
                      </span>
                      <span>
                        <span className="connector-name">{name}</span>
                        <br />
                        <span className="connector-state" data-connected={connected}>
                          {busy
                            ? 'Importing…'
                            : connected
                              ? 'Connected · import notes'
                              : 'Not connected'}
                        </span>
                      </span>
                    </button>
                  </Card>
                );
              })}
            </div>

            <Card>
              <span className="eyebrow">Transcript</span>
              <div style={{ height: 12 }} />
              {importing ? (
                <p className="line-text">
                  <span className="spinner" />
                  Importing notes from {importing}…
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
                      placeholder="Paste the recruiter call transcript, or import it above."
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                    />
                  </label>
                  <div style={{ height: 12 }} />
                  <p className="source">
                    Nothing is stored until you generate. Import from Granola to load the sample
                    conversation.
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
