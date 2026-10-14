/**
 * The one failure presentation every surface draws (tray notice card, open-work ledger): a
 * one-line human summary keyed by the refusal code, the one door that fixes it when one exists,
 * and the raw text to fold behind a disclosure. Codes are the SDK's own `CoreDiagnosticCode`
 * (vendored contract beside this file) plus the host's; a code with no line here says its first
 * sentence. A door is an address to open, never a write.
 */
import type { CoreDiagnosticCode } from "./vendor/generated/pe-revit-contract.ts";

export interface FailureSummary {
  /** The refusal code the text opened with, when it opened with one. */
  code: string | null;
  summary: string;
  door: { label: string; href: string } | null;
  /** The raw text, when the summary does not already say all of it. */
  detail: string | null;
}

type Line = (message: string) => string;
const REVIT_DOOR = { label: "Revit on Machine", href: "/machine?section=revit" };
const UPDATE_DOOR = { label: "Update on Machine", href: "/machine?section=update" };

const beta = (version: string) => /beta\.(\d+)/.exec(version)?.[1];
/** "(version skew: 0.1.0-beta.208 installed, 0.1.0-beta.207 here)" says which side is ahead. */
const bootstrapLine: Line = (message) => {
  const skew = /version skew: (\S+) installed, (\S+) here/.exec(message);
  const [installed, here] = [beta(skew?.[1] ?? ""), beta(skew?.[2] ?? "")];
  if (!installed || !here || installed === here)
    return "Revit's add-ins are a different Pe.Revit build than this checkout";
  const side = Number(installed) > Number(here) ? "a newer" : "an older";
  return `Revit's add-ins are ${side} Pe.Revit build (beta.${installed}) than this checkout (beta.${here})`;
};

const LINES: Partial<
  Record<CoreDiagnosticCode, { line: Line | string; door?: FailureSummary["door"] }>
> = {
  "session.bootstrap-mismatch": { line: bootstrapLine, door: REVIT_DOOR },
  "session.bootstrap-missing": {
    line: "Revit has no Pe.Revit add-ins for this year",
    door: REVIT_DOOR,
  },
  "session.no-revit": { line: "No Revit is installed for this year", door: REVIT_DOOR },
  "session.year-mismatch": {
    line: "This model belongs to a different Revit year",
    door: REVIT_DOOR,
  },
  "doc.revit-year-mismatch": {
    line: "This model belongs to a different Revit year",
    door: REVIT_DOOR,
  },
  "session.launch-failed": { line: "Revit did not start", door: REVIT_DOOR },
  "doc.cloud-unavailable": { line: "The cloud model is not reachable from this Revit" },
  "op.outcome-unknown": {
    line: "Revit did not say whether this finished: check before running it again",
  },
  "op.timed-out": { line: "Revit took too long and the request was stopped" },
  "update.download-failed": { line: "The update did not download", door: UPDATE_DOOR },
  "update.feed-unreachable": { line: "The update feed is not reachable", door: UPDATE_DOOR },
};

const MAX = 120;
/** The first sentence, capitalised, without its closing period, at most one line long. */
function firstSentence(message: string) {
  const sentence = (/^(.+?[.;!?])(?:\s|$)/s.exec(message.trim())?.[1] ?? message.trim()).replace(
    /[.;]$/,
    "",
  );
  const line = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
}

export function summarizeFailure(text: string): FailureSummary {
  const coded = /^([a-z][a-z-]*\.[a-z][a-z-]*):\s*([\s\S]*)$/.exec(text.trim());
  const code = coded?.[1] ?? null;
  const message = coded ? coded[2]! : text.trim();
  const known = code ? LINES[code as CoreDiagnosticCode] : undefined;
  const summary = known
    ? typeof known.line === "string"
      ? known.line
      : known.line(message)
    : firstSentence(message);
  const whole = message.replace(/[.;]\s*$/, "").trim();
  return {
    code,
    summary,
    door: known?.door ?? null,
    detail: code || summary !== whole ? text.trim() : null,
  };
}
