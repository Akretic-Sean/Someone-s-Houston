/**
 * Reads an uploaded transcript file.
 *
 * Everything happens in the browser: the file is never uploaded anywhere, which
 * matters because a recruiter call transcript is the most sensitive thing this
 * app touches. Nothing is stored until the recruiter generates a report.
 */

export const MAX_BYTES = 2 * 1024 * 1024;
export const ACCEPTED = '.txt,.md,.vtt,.srt,.text,text/plain,text/markdown';

export class TranscriptFileError extends Error {}

const TIMESTAMP =
  /^\d{1,2}:\d{2}(:\d{2})?([.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(:\d{2})?([.,]\d{1,3})?/;

/**
 * WebVTT and SRT carry cue numbers, timestamps and headers that would otherwise
 * reach the model as if they were speech. Plain text passes through untouched.
 */
export function stripCaptionMarkup(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    // Each cue is one utterance, so the blank separators between them are
    // noise rather than paragraph breaks.
    if (!line) continue;
    if (line === 'WEBVTT' || line.startsWith('NOTE ') || line.startsWith('STYLE')) continue;
    if (TIMESTAMP.test(line)) continue;
    // A bare integer between cues is an SRT sequence number.
    if (/^\d+$/.test(line)) continue;
    // WebVTT's <v Name> is the speaker attribution, not decoration: turn it
    // into "Name: ..." so the transcript keeps who said what. Other tags go.
    out.push(
      raw
        .replace(/<v(?:\.[^\s>]+)*\s+([^>]+)>/gi, (_m, name: string) => `${name.trim()}: `)
        .replace(/<\/?[^>]+>/g, '')
        .replace(/^(\s*)(\S[^:]*): \s+/, '$1$2: '),
    );
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A PDF or DOCX decodes into control characters rather than readable text. */
function looksBinary(text: string): boolean {
  for (const char of text.slice(0, 2000)) {
    const code = char.codePointAt(0) ?? 0;
    const printable = code === 9 || code === 10 || code === 13 || code >= 32;
    if (!printable) return true;
  }
  return false;
}

export async function readTranscriptFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new TranscriptFileError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`,
    );
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new TranscriptFileError('That file could not be read.');
  }

  if (looksBinary(text)) {
    throw new TranscriptFileError(
      'That looks like a binary file. Export the transcript as text (.txt, .md, .vtt or .srt).',
    );
  }

  const cleaned = /\.(vtt|srt)$/i.test(file.name) ? stripCaptionMarkup(text) : text.trim();
  if (!cleaned) throw new TranscriptFileError('That file is empty.');
  return cleaned;
}
