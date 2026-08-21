/**
 * PROTOTYPE — the one check the board's data layer earns.
 *
 * The drawings are judged by eye; the PAIRING is not. A greedy nearest-box match that silently
 * claimed the wrong extrusion would draw two plausible pictures under a wrong row table, which is
 * the exact failure mode this whole board exists to catch. So the rows are pinned here, against
 * the real fixture, with the numbers a real Revit produced.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  claimEdit,
  constituents,
  editKey,
  headline,
  reviewRows,
  stageEdit,
  stagedValue,
  tally,
  uneditableReason,
  type BoardFamily,
  type EditBook,
  type ReviewRow,
} from "./model.ts";
import { loadBoard } from "./proto/board.ts";

const board = loadBoard();
const by = (slug: string): BoardFamily => {
  const family = board.find((entry) => entry.slug === slug);
  if (!family) throw new Error(`fixture '${slug}' is missing`);
  return family;
};

describe("family review board", () => {
  it("stages every fixture family, refused ones included", () => {
    expect(board.map((family) => family.slug)).toEqual([
      "minimal-box",
      "family-model-showcase",
      "pe-grd-vane",
      "pe-wall-sink",
    ]);
  });

  it("pairs every showcase solid with the extrusion Revit built, and names the rest Revit-only", () => {
    const rows = reviewRows(by("family-model-showcase"), "Standard");
    const solids = rows.filter((row) => row.kind === "solid" && row.agreement !== "revit-only");
    // body · top-neck · access-slot · core-bore — the four authored solids, all within the
    // oracle's own 1e-6, which is what the fresh-lane assertion also proves.
    expect(solids.map((row) => row.label)).toEqual([
      "body",
      "top-neck",
      "access-slot",
      "core-bore",
    ]);
    expect(solids.every((row) => row.agreement === "agrees")).toBe(true);
    // Connector stubs are extrusions too, and no portable solid names them.
    expect(tally(rows)["revit-only"]).toBeGreaterThan(0);
  });

  it("says out loud that nothing reads the GRD's vanes", () => {
    const rows = reviewRows(by("pe-grd-vane"), "Fifteen Vanes");
    // The whole family is planes + a nested vane + an array. The oracle predicts no solid, so the
    // one extrusion Revit built is the face-based template's host placeholder — Revit-only — and
    // the array that makes fifteen vanes has NO reading at all. The eyeball is its only oracle.
    expect(
      rows.filter((row) => row.kind === "solid" && row.agreement === "revit-only"),
    ).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "array" && row.agreement === "unread")).toHaveLength(
      1,
    );
    expect(rows.filter((row) => row.kind === "nested" && row.agreement === "unread")).toHaveLength(
      1,
    );
    const planes = rows.filter((row) => row.kind === "plane");
    expect(planes.map((row) => row.label)).toEqual(["opening.Front", "opening.Back"]);
    expect(planes.every((row) => row.agreement === "agrees")).toBe(true);
  });

  it("makes a refused family board content rather than an error", () => {
    const family = by("pe-wall-sink");
    expect(family.probes).toEqual({});
    const rows = reviewRows(family, "Default");
    expect(headline(rows)).toBe("refused");
    expect(rows[0].label).toBe("unsupported-placement-geometry");
    // Every authored solid and connector still lists — the document is real, Revit just has none.
    expect(rows.filter((row) => row.kind === "solid")).toHaveLength(3);
  });

  it("compares settings against what Revit reports on the family element", () => {
    const rows = reviewRows(by("minimal-box"), "Default");
    const lookup = rows.find((row) => row.kind === "lookup");
    expect(lookup?.agreement).toBe("agrees");
    expect(rows.filter((row) => row.kind === "setting").length).toBeGreaterThan(0);
  });
});

/**
 * ROUND 2 — the two derivations the new pieces rest on.
 *
 * The sidebar's breakdown and the compact table's staging are both PURE, and pinned here rather
 * than in a DOM test: a wrong constituent count reads as a family with less in it than it has, and
 * a staging rule that accepted anything would put an unsaved mark on a cell that changed nothing.
 * Neither failure looks like a failure on screen.
 */
describe("constituent breakdown (the expand sidebar)", () => {
  it("counts and names what the showcase document declares", () => {
    const groups = constituents(by("family-model-showcase"));
    const kinds = Object.fromEntries(groups.map((group) => [group.kind, group]));
    expect(kinds.solids.names).toEqual(["body", "top-neck", "access-slot", "core-bore"]);
    expect(kinds.planes.count).toBe(3);
    expect(kinds.connectors.names).toEqual(["supply-air", "return-air", "condensate", "power"]);
    // One stated settings key (omniClass) plus the room calculation point section.
    expect(kinds.settings.names).toEqual(["omniClass", "roomCalculationPoint"]);
    expect(kinds.nested).toBeUndefined();
  });

  it("does not draw the GRD as an empty family just because no probe reads it", () => {
    const groups = constituents(by("pe-grd-vane"));
    const kinds = groups.map((group) => group.kind);
    // Its whole content is planes plus a nested vane plus an array. Omitting the two unread kinds
    // would leave the anchor family looking like two planes and nothing else.
    expect(kinds).toContain("nested");
    expect(kinds).toContain("arrays");
    expect(groups.every((group) => group.count > 0)).toBe(true);
  });

  it("lists a refused family's constituents — the document is real, Revit just has none", () => {
    const groups = constituents(by("pe-wall-sink"));
    // TWO, not the three solid ROWS the claim table shows: the third row is the refusal itself,
    // which is a fact about the run and never a constituent of the document.
    expect(groups.find((group) => group.kind === "solids")?.count).toBe(2);
    // A refused family still declares connectors and planes; the breakdown reads the DOCUMENT,
    // so it is the one part of the board that works when nothing was built.
    expect(groups.map((group) => group.kind)).toEqual(["solids", "planes", "connectors"]);
  });
});

describe("compact-mode edit staging", () => {
  const rows = reviewRows(by("minimal-box"), "Default");
  const row = (label: string, kind = "setting"): ReviewRow => {
    const found = rows.find((entry) => entry.kind === kind && entry.label === label);
    if (!found) throw new Error(`no ${kind} row '${label}'`);
    return found;
  };
  const stageKey = "minimal-box::Default";

  it("opens the caret on settings keys and refuses it everywhere else, with a reason", () => {
    expect(claimEdit(row("alwaysVertical"))).toBe("boolean");
    expect(claimEdit(row("omniClass"))).toBe("text");
    const solid = rows.find((entry) => entry.kind === "solid");
    expect(solid && claimEdit(solid)).toBe(null);
    // Every refusal says WHY — a locked cell with no reason is worse than a missing cell.
    expect(solid && uneditableReason(solid)).toContain("PREDICTION");
  });

  it("stages an edit under the family and type, keeping the document's own value as `from`", () => {
    const next = stageEdit({}, stageKey, row("alwaysVertical"), "true");
    expect(typeof next).not.toBe("string");
    const book = next as EditBook;
    const staged = book[editKey(stageKey, row("alwaysVertical").key)];
    expect(staged).toEqual({
      stageKey,
      rowKey: "setting:alwaysVertical",
      path: "settings.alwaysVertical",
      from: "false",
      to: "true",
    });
    expect(stagedValue(book, stageKey, row("alwaysVertical"))).toBe("true");
    // An edit is scoped to ONE family at ONE type; nothing about it reaches another stage.
    expect(stagedValue(book, "minimal-box::Other", row("alwaysVertical"))).toBe("false");
  });

  it("un-stages when the document's own value is committed back", () => {
    const book = stageEdit({}, stageKey, row("alwaysVertical"), "true") as EditBook;
    const back = stageEdit(book, stageKey, row("alwaysVertical"), "false") as EditBook;
    expect(Object.keys(back)).toEqual([]);
  });

  it("refuses rather than silently swallowing", () => {
    expect(stageEdit({}, stageKey, row("alwaysVertical"), "yes")).toContain("not true or false");
    expect(stageEdit({}, stageKey, row("omniClass"), "  ")).toContain("blank commits nothing");
    const solid = rows.find((entry) => entry.kind === "solid") as ReviewRow;
    expect(stageEdit({}, stageKey, solid, "0.5")).toBe(uneditableReason(solid));
  });
});
