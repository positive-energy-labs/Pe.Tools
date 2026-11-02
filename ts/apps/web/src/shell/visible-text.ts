/**
 * Internal identity that must never reach a person's eyes: UniqueIds/uuids (whole or a fragment),
 * port subject keys (`…@2`), hash disambiguators (`(00d1f963)`), ElementIds (`unit 8775469`,
 * `14106988:0`, `[14577391]`), session/open ids, and machine words the host emits.
 * Used by the fixture-route guard test and the browser sweep over fixture routes.
 */
const LEAKS: readonly [string, RegExp][] = [
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i],
  ["uuid fragment", /\b[0-9a-f]{8}-…/i],
  ["port key", /[0-9a-f]{8}(?:-[0-9a-f]+)*@\d+/i],
  ["hash disambiguator", /\((?=[0-9a-f]*\d)[0-9a-f]{8}\)/i],
  ["loss method token", /\bno server\b|\bpe-server\b|\bnot-defined\b/],
  ["store token", /derived store|store: absent/],
  // Manual D #5 defect 7: Revit ElementIds in any spelling. Elements read through elementLabeler.
  ["element id", /\b(?:unit|element) #?\d+\b/i],
  ["bracketed id", /\[\d{3,}\]/],
  ["connector key", /\b\d{3,}:\d+\b/],
  // Small fixture ids too ("auto-joined 1:1 to 2:0"); a clock or scale never pairs this way.
  ["connector pair", /\b\d+:\d+ (?:to|and|→) \d+:\d+\b/],
  // A date inside an op id (op-20260830-1842) is not an element.
  ["bare element id", /(?<![\d.,-])\d{7,}(?![\d.,])/],
  ["session id", /\bsession-[0-9a-f]{6,}|\b[0-9a-f]{16,}\b/i],
];
/** Each leak found in `text`; `internal` adds exact tokens (verb ids, pane ids) that must not render. */
export function leaks(text: string, internal: readonly string[] = []): string[] {
  const found = LEAKS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  // Exact-token match bounded by non-identifier characters, so "sheet-inputs" never matches "Edit sheet inputs".
  const bounded = (token: string) => (part: string) => part === token;
  for (const token of internal)
    if (text.split(/[^\w-]+/).some(bounded(token))) found.push(`internal token ${token}`);
  return found;
}
