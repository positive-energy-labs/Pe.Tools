/**
 * PROTOTYPE — the one check the editing paradigms earn.
 *
 * Paradigm A's whole claim is the two-direction view: what is defined OFF this datum, and what it
 * is defined FROM. A derivation that quietly missed an edge would draw a confident, empty "nothing
 * reads this" over a plane four constructs depend on — and then offer to re-anchor zero of them.
 * That is the failure this pins, against the real showcase `family.json`.
 */
import { describe, expect, it } from "vite-plus/test";

import { anchors, dependents, familyGraph, legalRefs, retarget, showcaseModel } from "./model.ts";

const model = showcaseModel();
const graph = familyGraph(model);
const edgeText = (id: string, direction: "off" | "from") =>
  (direction === "off" ? dependents(graph, id) : anchors(graph, id)).map(
    (edge) => `${edge.from} · ${edge.field} → ${edge.to}`,
  );

describe("proto-editor · relation graph", () => {
  it("reads a frame in both directions", () => {
    // return-air is the interesting one: its origin crosses a solid FACE, a stock family plane and
    // an authored plane — one frame, three different kinds of anchor.
    expect(edgeText("frame:return-air", "from")).toEqual([
      "frame:return-air · origin[0] → face:body.Back",
      "frame:return-air · origin[1] → plane:family.CenterLR",
      "frame:return-air · origin[2] → plane:return-elevation",
    ]);
    expect(edgeText("frame:return-air", "off")).toEqual([
      "connector:return-air · frame → frame:return-air",
    ]);
  });

  it("folds faces into their solid, so a solid answers with the frames that hang off it", () => {
    expect(edgeText("solid:body", "off")).toEqual([
      "frame:supply-air · origin[0] → face:body.Top",
      "frame:return-air · origin[0] → face:body.Back",
      "frame:condensate · origin[0] → face:body.Left",
      "frame:power · origin[0] → face:body.Right",
    ]);
  });

  it("counts a formula as a relation — 'where does this number come from' is an edge", () => {
    expect(edgeText("param:Body Height", "off")).toEqual([
      "param:Core Height · formula → param:Body Height",
      "solid:body · height → param:Body Height",
    ]);
    expect(edgeText("param:Core Height", "from")).toEqual([
      "param:Core Height · formula → param:Body Height",
      "param:Core Height · formula → param:Top Height",
    ]);
  });

  it("re-anchors every dependent of a plane in one action", () => {
    const moved = retarget(graph, model, "plane:return-elevation", "plane:pipe-elevation");
    expect(moved.moved).toEqual(["frame:return-air · origin[2]"]);
    expect(moved.model.frames?.["return-air"]?.origin).toEqual([
      "face:body.Back",
      "plane:family.CenterLR",
      "plane:pipe-elevation",
    ]);
    // Immutable: the document the test started from is untouched.
    expect(model.frames?.["return-air"]?.origin[2]).toBe("plane:return-elevation");
  });

  it("scopes a slot to what is legal there, not to every string in the document", () => {
    expect(legalRefs(model, "frame")).toEqual([
      "frame:family",
      "frame:supply-air",
      "frame:return-air",
      "frame:condensate",
      "frame:power",
    ]);
    // All 19 showcase parameters are lengths; a non-length one would not be offered to a `width`.
    expect(legalRefs(model, "lengthParam")).toHaveLength(19);
    // A cylinder has two faces, a prism six — the anchor picker never offers `face:top-neck.Left`.
    expect(legalRefs(model, "anchor")).toContain("face:top-neck.Top");
    expect(legalRefs(model, "anchor")).not.toContain("face:top-neck.Left");
  });
});
