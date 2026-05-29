/**
 * Responsive breakpoints (NFR23, UX-DR8). Shared across the timeline/claim
 * layout (Story 2.4) and the full dashboard composition (Story 2.6).
 *
 * - mobile  (≥320px):        legible, no horizontal page scroll
 * - tablet  (768–1279px):    timeline / detail / score stack vertically
 * - desktop (≥1280px):       timeline + claim detail + score shown together
 *
 * CSS media queries in the components use these same pixel values; keep them
 * in sync with this single source of truth.
 */
export const BREAKPOINTS = {
  mobileMin: 320,
  tablet: 768,
  desktop: 1280,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;
