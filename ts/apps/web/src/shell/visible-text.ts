/**
 * Internal identity that must never reach a person's eyes: UniqueIds/uuids (whole or a fragment),
 * port subject keys (`…@2`), hash disambiguators (`(00d1f963)`), and machine words the host emits.
 * Used by the fixture-route guard test and the browser sweep over fixture routes.
 */
const LEAKS: readonly [string, RegExp][] = [
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i],
  ["uuid fragment", /\b[0-9a-f]{8}-…/i],
  ["port key", /[0-9a-f]{8}(?:-[0-9a-f]+)*@\d+/i],
  ["hash disambiguator", /\((?=[0-9a-f]*\d)[0-9a-f]{8}\)/i],
  ["loss method token", /\bno server\b|\bpe-server\b|\bnot-defined\b/],
  ["store token", /derived store|store: absent/],
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
