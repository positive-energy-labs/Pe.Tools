import type { FanIssue } from "@pe/fans-contract/fans-inputs";
import type { InboxItem } from "./inbox-rows.ts";

export function encounterRows(issues: readonly FanIssue[]): InboxItem[] {
  return [...new Map(issues.filter(i => i.closer.kind === "encounter").map(issue => {
    const e = issue.closer;
    if (e.kind !== "encounter") throw Error("Expected an encounter");
    const key = `encounter:${e.encounter.elementId}:${e.encounter.connector}`;
    const row: InboxItem = { key, group: "fix", kind: "encounter", title: "Fan tie-in ruling",
      titleParts: ["Fan tie-in at ", { id: issue.elementId }], status: e.encounter.verdict,
      ids: [issue.elementId], note: "Accept this tie-in or leave the guest incomplete.",
      verbs: [ { kind: "encounter", issue, choice: "connect", label: "accept encounter" },
        { kind: "encounter", issue, choice: "ignore", label: "refuse encounter" } ] };
    return [key, row] as const;
  })).values()];
}
