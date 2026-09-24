/** How strongly the accent tints a comment's quote. */
export const HIGHLIGHT_ALPHA = { active: 0.45, pending: 0.22, delivered: 0.12 } as const;

export type Tint = keyof typeof HIGHLIGHT_ALPHA;
