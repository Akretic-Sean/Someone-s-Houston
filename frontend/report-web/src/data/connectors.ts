/**
 * Sources a recruiter conversation can be imported from.
 *
 * Connecting happens on the Connectors screen; the report builder only offers
 * the ones already connected, so step 1 stays about the conversation rather
 * than about setup.
 */
export interface Connector {
  id: ConnectorId;
  name: string;
  /** Two or three characters for the tile. */
  mark: string;
  /** What this source provides, shown on the Connectors screen. */
  blurb: string;
}

export type ConnectorId =
  | 'granola'
  | 'fireflies'
  | 'fathom'
  | 'zoom'
  | 'claude'
  | 'chatgpt';

export const CONNECTORS: Connector[] = [
  {
    id: 'granola',
    name: 'Granola',
    mark: 'G',
    blurb: 'Meeting notes from recruiter calls.',
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    mark: 'Ff',
    blurb: 'Call recordings and transcripts.',
  },
  {
    id: 'fathom',
    name: 'Fathom',
    mark: 'Fa',
    blurb: 'Recorded calls with highlights.',
  },
  {
    id: 'zoom',
    name: 'Zoom Notes',
    mark: 'Z',
    blurb: 'Zoom meeting summaries and transcripts.',
  },
  {
    id: 'claude',
    name: 'Claude',
    mark: 'C',
    blurb: 'Import a conversation you worked through with Claude.',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    mark: 'GP',
    blurb: 'Import a conversation you worked through with ChatGPT.',
  },
];

export type ConnectorState = 'idle' | 'connected';
export type ConnectorStates = Record<ConnectorId, ConnectorState>;

/** Granola alone starts connected, so the builder has exactly one source. */
export const DEFAULT_CONNECTORS: ConnectorStates = {
  granola: 'connected',
  fireflies: 'idle',
  fathom: 'idle',
  zoom: 'idle',
  claude: 'idle',
  chatgpt: 'idle',
};
