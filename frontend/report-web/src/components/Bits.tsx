import type { ReactNode } from 'react';
import type { ReportStatus } from '../types';

export function Brand({ sub }: { sub?: string }) {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        H
      </span>
      <div>
        <div className="wordmark">
          Someone&rsquo;s <em>Houston</em>
        </div>
        {sub ? <div className="brand-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function Source({ children }: { children: ReactNode }) {
  return <div className="source">Source: {children}</div>;
}

const STATUS_CLASS: Record<ReportStatus, string> = {
  Viewed: 'status-viewed',
  Shared: 'status-shared',
  Draft: 'status-draft',
  'Expert opt-in': 'status-opt-in',
};

export function StatusPill({ status }: { status: ReportStatus }) {
  return <span className={`status ${STATUS_CLASS[status]}`}>{status}</span>;
}

/** Two-option segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('');
}
