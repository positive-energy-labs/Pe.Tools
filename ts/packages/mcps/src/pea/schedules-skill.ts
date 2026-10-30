import schedulesGraph from "./generated/schedules-graph.json" with { type: "json" };

export function renderSchedulesSkill(): string {
  return [
    "---",
    "name: edit-schedule-grid",
    "description: Inspect a schedule grid, propose keyed cell edits, and review or apply them with exact host evidence.",
    "---",
    "",
    "# Edit a schedule grid",
    "",
    "Read op:schedule.grid.snapshot with an exact project document. Its workspaceId selects route:schedules Work; its immutable reading supplies the native binding basis.",
    "Read the Work revision before proposing cells. Never author basis, takenAt, readback or receipts. The host binds readings with op:schedule.grid.bind and records each publication.",
    "Use the graph's cell verbs to take, reject, reopen or delete a keyed cell. Apply cells reviews the exact Work and its bindings before schedule.grid.push. A changed Work revision makes that ticket stale. History is read-only.",
    "Push refusals and unread readback counts are readings derived from host receipts. They are never Page or authored Work. A saved spec uses schedule.apply; capture uses schedule.capture.",
    "",
    "The Schedules route graph:",
    "```json",
    JSON.stringify(schedulesGraph, null, 2),
    "```",
    "",
  ].join("\n");
}
