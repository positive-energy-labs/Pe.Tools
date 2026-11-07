export const chatSeedChoices = {
  send: "an idle thread ready for a prompt",
  new: "a thread to leave for a fresh one",
  diagram: "pea drew a duct system, after one rejected diagram call",
  attach: "the user attached a photo, a CSV and a PDF; pea read all three",
  skill: "the user ran a slash skill; the harness advertised its commands",
  mention: "the user mentioned a document and a skill with @; pea used their ids",
  closed: "a thread whose bound session has closed; send refuses until a live document is chosen",
  granted: "a human added a second document to the thread; it targets two",
  ask: "pea waiting on a question; composer text answers it through Other",
  stop: "pea mid-turn, with an approval owed",
} as const;
