// Verdict domain model + presentation metadata.
// The five canonical verdict states and their design-token / label mapping.
// Token suffix maps to the --verdict-<token>-bg / -ink custom properties
// defined in styles/foundations.css (Story 2.1).

export type Verdict =
  | 'DELIVERED'
  | 'MISSED'
  | 'PENDING'
  | 'INSUFFICIENT_DATA'
  | 'REVISED';

export type VerdictToken =
  | 'delivered'
  | 'missed'
  | 'pending'
  | 'insufficient'
  | 'revised';

export interface VerdictMeta {
  /** Sentence-case label — always shown alongside colour, never colour alone (UX-DR2). */
  label: string;
  /** Suffix for the --verdict-<token>-* CSS custom properties. */
  token: VerdictToken;
}

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  DELIVERED: { label: 'Delivered', token: 'delivered' },
  MISSED: { label: 'Missed', token: 'missed' },
  PENDING: { label: 'Pending', token: 'pending' },
  INSUFFICIENT_DATA: { label: 'Insufficient data', token: 'insufficient' },
  REVISED: { label: 'Revised', token: 'revised' },
};

/** All verdict states, in canonical display order. */
export const VERDICTS = Object.keys(VERDICT_META) as Verdict[];
