/**
 * PROTOTYPE — the three derivations the composed page cannot be judged by eye on.
 *
 * The layout is an eyeball question. These three are not: a parameter cell that says "inherits"
 * over a value a type actually overrode, a json highlight that lands two lines off, and a sentence
 * row whose cells drift out of their columns all LOOK fine and are wrong. Pinned against the real
 * showcase fixture.
 */
import { describe, expect, it } from "vite-plus/test";

import { jsonWithSpans, lineSpan, ownerOf, pointerAtOffset } from "./json-map.ts";
import { showcaseModel } from "./model.ts";
import { paramRows, viewRows, DEFAULT_VIEW } from "./params.ts";
import { sentenceGroups } from "./sentences.ts";

const model = showcaseModel();
const rowOf = (name: string) => {
  const row = paramRows(model).find((entry) => entry.name === name);
  if (!row) throw new Error(`parameter '${name}' is missing from the fixture`);
  return row;
};

describe("composed · parameter cells across types", () => {
  it("separates a type's own value from an inherited one", () => {
    const height = rowOf("Body Height");
    expect(height.base.text).toBe("30in");
    // Compact and Tall each write their own; Standard overrides nothing and INHERITS — the
    // distinction the whole cross-type column exists to show.
    expect(height.byType["Compact"]).toMatchObject({ text: "24in", source: "override" });
    expect(height.byType["Standard"]).toMatchObject({ text: "30in", source: "value" });
    expect(height.byType["Tall"]).toMatchObject({ text: "42in", source: "override" });
    expect(height.byType["Tall"]?.pointer).toBe("/types/Tall/Body Height");
  });

  it("refuses every type cell of a formula-driven parameter, in words", () => {
    const core = rowOf("Core Height");
    expect(core.base.text).toBe("= Body Height + Top Height");
    expect(core.base.pointer).toBe("/familyParameters/Core Height/formula");
    for (const typeName of ["Compact", "Standard", "Tall"]) {
      expect(core.byType[typeName]?.source).toBe("formula");
      expect(core.byType[typeName]?.lock).toContain("a formula computes this");
    }
  });

  it("counts the constructs that read a parameter, and filters to the audit read", () => {
    expect(rowOf("Body Width").reads).toBe(1); // solid body's width
    expect(rowOf("Stub Depth").reads).toBe(4); // one per connector stub
    const overridden = viewRows(paramRows(model), { ...DEFAULT_VIEW, overriddenOnly: true });
    expect(overridden.map((row) => row.name)).toEqual([
      "Body Depth",
      "Body Height",
      "Body Width",
      "Electrical Elevation",
      "Return Elevation",
    ]);
  });
});

describe("composed · json pointer ↔ character range", () => {
  const map = jsonWithSpans(model);

  it("emits exactly what JSON.stringify emits — the map cannot drift from the text", () => {
    expect(map.text).toBe(JSON.stringify(model, null, 2));
  });

  it("maps a pointer to the property text, key included", () => {
    const span = map.byPointer.get("/familyParameters/Body Width/value");
    expect(span).toBeDefined();
    expect(map.text.slice(span!.start, span!.end)).toBe('"value": "24in"');

    const frame = map.byPointer.get("/frames/return-air/origin/2");
    expect(map.text.slice(frame!.start, frame!.end)).toBe('"plane:return-elevation"');

    const solid = map.byPointer.get("/solids/body");
    expect(map.text.slice(solid!.start, solid!.start + 8)).toBe('"body": ');
  });

  it("maps an offset back to the deepest pointer that contains it", () => {
    const span = map.byPointer.get("/familyParameters/Body Width/value")!;
    expect(pointerAtOffset(map, span.start + 3)).toBe("/familyParameters/Body Width/value");
    // …and the structured surface asks for the row that OWNS it.
    const owners = new Set(["/familyParameters/Body Width", "/solids/body"]);
    expect(ownerOf(pointerAtOffset(map, span.start + 3), owners)).toBe(
      "/familyParameters/Body Width",
    );
  });

  it("reports a span's line range against the emitted text", () => {
    const span = map.byPointer.get("/family/name")!;
    const [first, last] = lineSpan(map, span);
    expect(first).toBe(last);
    expect(map.text.split("\n")[first - 1]?.trim()).toBe('"name": "PE Family Model Showcase",');
  });
});

describe("composed · sentence row slot alignment", () => {
  const groups = sentenceGroups(model);
  const group = (key: string) => {
    const found = groups.find((entry) => entry.key === key);
    if (!found) throw new Error(`group '${key}' is missing`);
    return found;
  };

  it("gives every row of a kind one cell per slot, in slot order — the alignment invariant", () => {
    for (const entry of groups)
      for (const row of entry.rows) expect(row.cells.map((cell) => cell.slot)).toEqual(entry.slots);
  });

  it("leaves a cylinder's width and depth columns BLANK rather than shifting its diameter left", () => {
    const solids = group("solids");
    expect(solids.slots).toEqual([
      "kind",
      "name",
      "on",
      "frame",
      "width",
      "depth",
      "height",
      "diameter",
    ]);
    const cell = (id: string, slot: string) =>
      solids.rows.find((row) => row.id === id)?.cells.find((entry) => entry.slot === slot);

    expect(cell("solid:body", "width")).toMatchObject({
      kind: "ref",
      value: "param:Body Width",
      pointer: "/solids/body/width",
    });
    expect(cell("solid:body", "diameter")?.kind).toBe("blank");
    expect(cell("solid:top-neck", "width")?.kind).toBe("blank");
    expect(cell("solid:top-neck", "depth")?.kind).toBe("blank");
    expect(cell("solid:top-neck", "diameter")).toMatchObject({
      kind: "ref",
      value: "param:Top Diameter",
    });
    // height is the one dimension both kinds carry — so it aligns, which is the point.
    expect(cell("solid:body", "height")?.kind).toBe("ref");
    expect(cell("solid:top-neck", "height")?.kind).toBe("ref");
  });

  it("keeps a rectangular connector's diameter column blank and a round one's width blank", () => {
    const cell = (id: string, slot: string) =>
      group("connectors")
        .rows.find((row) => row.id === id)
        ?.cells.find((entry) => entry.slot === slot);
    expect(cell("connector:supply-air", "diameter")?.kind).toBe("ref");
    expect(cell("connector:supply-air", "width")?.kind).toBe("blank");
    expect(cell("connector:return-air", "diameter")?.kind).toBe("blank");
    expect(cell("connector:return-air", "width")?.kind).toBe("ref");
    expect(cell("connector:return-air", "stubDepth")?.pointer).toBe(
      "/connectors/return-air/stub/depth",
    );
  });

  it("names the empty kinds instead of hiding them", () => {
    expect(group("arrays").rows).toHaveLength(0);
    expect(group("nested").exit).toContain("Unhosted");
  });
});
