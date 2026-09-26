// @vitest-environment jsdom
/**
 * The feedback inbox, deterministic: a hand-made Work (a Pea proposal, a staged merge, a staged
 * reject, a note) over a one-run fixture snapshot. Row order and glyphs come from `inboxCards`;
 * `accept` on the card writes the staged transition through the wire, bound to the revision.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { roomsRouteState, type Mark, type RouteStatePatch } from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import { cardsMarkdown, coverage, inboxCards, rdp } from "./cards";
import { cardLine, cardMoves, FeedbackCard, RoomsInbox } from "./inbox";

afterEach(cleanup);

const VIEW = "L1 - Rooms";
const square = (x: number, y: number, w: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + w],
  [x, y + w],
];
type Region = RoomsSnapshot.Res.RoomsRegion;
const region = (guid: string, name: string, x: number): Region => ({
  elementId: 1,
  guid,
  view: VIEW,
  level: "L1",
  role: "room",
  zone: "z",
  designation: null,
  name,
  type: "hall",
  ceilingFt: null,
  people: null,
  lightingW: null,
  equipSensible: null,
  equipLatent: null,
  ventilationCfm: null,
  sqft: 100,
  outer: square(x, 0, 10),
  holes: [],
  label: [x + 5, 5],
  runId: "r1",
  reason: null,
  touched: false,
  locked: false,
  stale: false,
});
const snapshot: RoomsSnapshot.Res.Response = {
  levels: [{ name: "L1", elevation: 0, views: [VIEW] }],
  regions: [region("a", "Kitchen", 0), region("b", "Nook", 10), region("c", "Closet", 30)],
};
const mark = (kind: Mark["kind"], polygon: [number, number][], guids: string[]): Mark => ({
  kind,
  anchor: { view: VIEW, level: "L1", polygon },
  run: "r1",
  guids,
});
const proposal = mark("merge", [...square(0, 0, 20)], ["a", "b"]);
const doc = roomsRouteState.schema.parse({
  marks: {
    p1: { proposal: { value: proposal } },
    s2: { staged: { value: mark("merge", square(0, 0, 20), ["a", "b"]) } },
    s1: { staged: { value: mark("reject", square(30, 0, 10), ["c"]) } },
  },
  notes: {
    n1: {
      anchor: { view: VIEW, level: "L1", polygon: [[35, 5]] },
      text: "this is a closet",
      by: "person",
      at: "2026-09-26T12:00:00.000Z",
    },
  },
});
const labelOf = (guid: string) => snapshot.regions.find((r) => r.guid === guid)?.name;
const cards = inboxCards(doc, snapshot, VIEW);

test("the inbox rows run proposed, accepted by id, then the note, each with its glyph and tag", () => {
  render(
    <RoomsInbox
      cards={cards}
      regions={snapshot.regions}
      labelOf={labelOf}
      pinned={null}
      onPin={() => {}}
      onHover={() => {}}
      markdown={() => ""}
      snap={async () => null}
    />,
  );
  const list = screen.getByLabelText("feedback inbox");
  const glyphs = [...list.querySelectorAll("[data-glyph]")].map((node) => node.textContent);
  expect(glyphs).toEqual(["◆", "●", "●", "✎"]);
  expect(cards.map((card) => [card.id, card.state, card.by])).toEqual([
    ["p1", "proposed", "pea"],
    ["s1", "accepted", "person"],
    ["s2", "accepted", "person"],
    ["n1", "note", "person"],
  ]);
  expect(list.textContent).toContain("[p1]");
  expect(list.textContent).toContain("(s1)");
  expect(cardLine(cards[0]!, labelOf)).toBe("merge · Kitchen, Nook · 400 sf");
  expect(cardLine(cards[3]!, labelOf)).toBe("note · Closet · this is a closet");
});

test("accept on Pea's card writes marks/p1/staged through the wire, bound to the revision", async () => {
  const wrote: [RouteStatePatch[], number | undefined][] = [];
  const write = async (patches: RouteStatePatch[], revision?: number) => {
    wrote.push([patches, revision]);
    return null;
  };
  const apply = { refusal: () => null, run: async () => null };
  const p1 = cards[0]!;
  const verbs = cardMoves(p1, { write, revision: 7 }, apply);
  expect(verbs.map((verb) => verb.word)).toEqual(["accept", "reject"]);
  render(<FeedbackCard card={p1} line="" regions={snapshot.regions} verbs={verbs} />);
  fireEvent.click(screen.getByText("accept"));
  await waitFor(() => expect(wrote.length).toBe(1));
  expect(wrote[0]).toEqual([[{ path: ["marks", "p1", "staged"], value: { value: proposal } }], 7]);
  // The written Work still parses, and now reads as accepted.
  const next = roomsRouteState.schema.parse({
    ...doc,
    marks: { ...doc.marks, p1: { ...doc.marks.p1, staged: { value: proposal } } },
  });
  expect(inboxCards(next, snapshot, VIEW).find((card) => card.id === "p1")?.state).toBe("accepted");
  // The staged cards carry their own verbs: a person's merge applies or deletes; a note deletes.
  expect(cardMoves(cards[2]!, { write, revision: 7 }, apply).map((v) => v.word)).toEqual([
    "apply",
    "delete",
  ]);
  expect(cardMoves(cards[3]!, { write, revision: 7 }, apply).map((v) => v.word)).toEqual([
    "delete",
  ]);
});

test("copy markdown writes cardsMarkdown to the clipboard and says so", async () => {
  const copied: string[] = [];
  const writeText = async (text: string) => void copied.push(text);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(
    <RoomsInbox
      cards={cards}
      regions={snapshot.regions}
      labelOf={labelOf}
      pinned={null}
      onPin={() => {}}
      onHover={() => {}}
      markdown={() => cardsMarkdown(doc, snapshot)}
      snap={async () => null}
    />,
  );
  fireEvent.click(screen.getByText("copy markdown"));
  await waitFor(() => expect(screen.getByText("copied")).toBeTruthy());
  expect(copied).toEqual([cardsMarkdown(doc, snapshot)]);
  expect(copied[0]).toContain("◆ proposed · merge p1");
});

test("a lasso covers the regions it half fills; RDP drops the points on a straight edge", () => {
  expect(coverage(square(0, 0, 16), snapshot.regions)).toEqual(["a", "b"]);
  expect(coverage(square(0, 0, 14), snapshot.regions)).toEqual(["a"]);
  const edge = [0, 1, 2, 3, 4, 5].map((x) => [x, 0.01 * (x % 2)] as const);
  expect(rdp(edge, 0.3)).toEqual([edge[0], edge[5]]);
});
