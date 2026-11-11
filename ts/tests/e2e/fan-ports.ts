// The F1 rule "the URL's fans agree with the roster selection", as a pure check. A fan port id is
// a SubjectRef code `UniqueId:<unit>#port:<n>`; it is decoded through the one codec, never a regex.
import { decode } from "../../packages/agent-contracts/src/subject-ref.ts";

/** "FC-23 · Level 1/Main Level / port 1" → { mark: "FC-23", port: "1" }; the heading draws mark · port. */
export const part = (label: string) => {
  const m = /^(.*?)(?: · .*)? \/ port (\d+)$/.exec(label);
  return { mark: m?.[1] ?? label, port: m?.[2] ?? "?" };
};

/** True, or what was seen instead. Selected rows with no URL id, or an id that is not a port, never pass. */
export function fanPortsAgree(fanIds: readonly string[], selected: readonly string[]): true | string {
  if (selected.length && !fanIds.length) return `URL names no fan with [${selected}] selected`;
  const ports: string[] = [];
  for (const id of fanIds) {
    const ref = decode(id);
    if (!ref.ok) return `URL fan id ${JSON.stringify(id)} is no SubjectRef: ${ref.reason}`;
    if (!ref.value.sub || !("port" in ref.value.sub)) return `URL fan id ${JSON.stringify(id)} names no port`;
    ports.push(String(ref.value.sub.port));
  }
  const want = selected.map((l) => part(l).port).sort();
  return ports.sort().join() === want.join() || `URL fan ports [${ports}] vs selected [${selected}]`;
}
