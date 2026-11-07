import { z } from "zod";

/** Validator details belong to diagnostics, never to a product sentence. */
export function readableRefusal(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  let issues: unknown = error instanceof z.ZodError ? error.issues : null;
  if (!issues) {
    try { issues = JSON.parse(message); } catch { /* Domain sentences remain readable. */ }
  }
  return Array.isArray(issues) && issues.length > 0 && issues.every(issue =>
    issue !== null && typeof issue === "object" && "code" in issue && "path" in issue)
    ? fallback : message;
}

export function podDiagnostic(issue: { code: string; message: string }): string {
  switch (issue.code) {
    case "InvalidRoute": return "Route unavailable: this Pod does not declare a current typed route artifact. Import the current example or rebuild this Pod.";
    case "RouteFingerprintMismatch": return "Route unavailable: its artifact bytes do not match the declared fingerprint. Rebuild this Pod before trusting it.";
    case "InvalidEntrypoint":
    case "MissingEntrypoint": return "Script unavailable: its declared entrypoint has no admitted source. Repair this Pod's script declaration.";
    case "ShippedExampleUpdateKept": return readableRefusal(issue.message, "Example update kept: its provenance could not be verified. Your Pod was preserved.");
    default: return `Pod member unavailable (${issue.code}): inspect and repair this Pod before using it.`;
  }
}
