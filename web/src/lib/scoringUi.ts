/** Last scoring run after Sync — shown on Debug tab */
export type ScoringRunBanner =
  | { variant: 'success'; text: string }
  | { variant: 'warning'; text: string }
  | { variant: 'error'; text: string };
