import type { RoomsRouteDocument } from "@pe/agent-contracts";
import type { Closer, Goal } from "@pe/agent-contracts/slots";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";
import { CARD_META, inboxCards, type Card } from "./cards.ts";
import { levelOrder, regionCode, roomRows } from "./rows.ts";

/*
 * The partition inbox as the route's Goal (ADR 0035 rule 8; routes ledger, slice 10 slot plan): what
 * is left on the chosen view comes first. A mark the newest run does not honour, or whose region
 * moved or is gone, is unresolved and a person's to redraw or delete; a mark staged against the
 * newest run is assumed until a rerun answers it. Pure: the host read runs it, and Pea reads the
 * same Goal the pane draws.
 */
const WANTS_A_PERSON = new Set<Card["state"]>(["fail", "stale", "gone"]);

export function roomsGoal(
  work: Pick<RoomsRouteDocument, "marks">,
  snapshot: RoomsSnapshot.Res.Response,
  view: string,
): Omit<Goal<string>, "inputs"> & { inputs: readonly never[] } {
  const labels = new Map(
    roomRows(snapshot.regions, levelOrder(snapshot.levels)).map((row) => [row.region.guid, row.label]),
  );
  const rooms = snapshot.regions.filter((r) => r.view === view && r.role === "room").length;
  const closer = (card: Card): Closer => ({
    id: `mark:${card.id}`,
    says: [
      `${card.kind} ${card.guids.map((guid) => labels.get(guid) ?? guid.slice(0, 8)).join(", ")}`.trim(),
      CARD_META[card.state].says,
    ].join(" · "),
    resolver: "person",
    ...(card.guids[0] ? { subject: regionCode(card.guids[0]) } : {}),
  });
  const cards = view ? inboxCards(work, snapshot, view) : [];
  const unresolved: Closer[] = !view
    ? [{ id: "view", says: "Choose a level and a plan view", resolver: "person" }]
    : [
        ...(rooms ? [] : [{ id: "partition", says: `No rooms on ${view} yet: partition it`, resolver: { op: "rooms.partition" } }]),
        ...cards.filter((card) => WANTS_A_PERSON.has(card.state)).map(closer),
      ];
  return {
    unresolved,
    assumed: cards.filter((card) => card.state === "accepted").map(closer),
    next: unresolved[0] ?? null,
    inputs: [],
    result: unresolved.length
      ? { kind: "estimate", value: null, sources: [] }
      : { kind: "complete", value: `${rooms} room${rooms === 1 ? "" : "s"} on ${view}` },
  };
}
