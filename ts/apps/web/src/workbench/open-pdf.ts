// A PDF attachment opens in the browser's own viewer, in a new tab; no PDF library.

/** Long enough for the new tab to fetch the blob; the URL is dead after. */
const REVOKE_AFTER_MS = 60_000;

export const isPdf = (mimeType: string, data: string | undefined): data is string =>
  mimeType === "application/pdf" && !!data;

export function openPdf(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
