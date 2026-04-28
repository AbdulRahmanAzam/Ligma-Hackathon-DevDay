export const INTENT_LABELS = [
  "action item",
  "decision",
  "open question",
  "reference",
] as const;

export type IntentLabel = (typeof INTENT_LABELS)[number];

export const INTENT_THRESHOLD = 0.55;

export const INTENT_HYPOTHESIS = "This text is a {}.";

export const INTENT_BADGE_COLOR: Record<IntentLabel, string> = {
  "action item": "#16a34a",
  decision: "#7c3aed",
  "open question": "#eab308",
  reference: "#94a3b8",
};

export const INTENT_BADGE_ICON: Record<IntentLabel, string> = {
  "action item": "✔",
  decision: "⚖",
  "open question": "?",
  reference: "🔖",
};
