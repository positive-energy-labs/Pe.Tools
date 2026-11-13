import { workKey, type TimelineRow } from "@pe/agent-contracts";

/** The host supplies row order and identity; equal revisions on different Works are distinct. */
export function timelineRowKey(row: TimelineRow): string {
  switch (row.kind) {
    case "edit": case "restore": return `${row.kind}:${workKey(row.work)}:${row.revision}`;
    case "home-write": return `home:${row.home}:${row.path}:${row.sha256}`;
    default: return `${row.kind}:${row.id}`;
  }
}
export function activityTime(at: number | string) {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour12: false }) : "Time unavailable";
}
