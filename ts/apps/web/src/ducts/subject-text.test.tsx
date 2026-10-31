// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import snapshot from "./fixtures/synthetic-snapshot.json";
import { subjectNamer } from "./subject-text";
import { SubjectText, subjectDocument } from "@pe/kit/lang/subject-text";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { makeAtomRegistry } from "#/shell/owner";
import { TestAttention } from "#/test-attention";
import { citation } from "@pe/kit/lang/attention";

afterEach(cleanup);
const names = new Map([
  [10368760, "14×10 elbow"],
  [12317607, "14×10 duct"],
  [12317611, "14×10 duct"],
]);
const nameOf = (id: number) => names.get(id) ?? null;

test("structured and free references number in reading order, reusing the element number across ports", () => {
  const doc = subjectDocument(
    [
      "Branch ",
      { id: 10368760 },
      " ends at 12317607:0 facing 12317611:0; back to 12317607:1 and 10368760.",
    ],
    nameOf,
  );
  expect(doc.references.map((r) => [r.id, r.number])).toEqual([
    [10368760, 1],
    [12317607, 2],
    [12317611, 3],
  ]);
  expect(
    doc.parts.filter((p) => typeof p !== "string").map((p) => [p.number, p.connector]),
  ).toEqual([
    [1, undefined],
    [2, 0],
    [3, 0],
    [2, 1],
    [1, undefined],
  ]);
});

test("unknown ids, dimensions, decimals and embedded keys stay honest; row ids supply missing subjects once", () => {
  const prose = "42 cfm, 14×10, 10368760.5, g10368760 and unknown 99999999";
  const doc = subjectDocument([prose], nameOf, [12317607, 12317607]);
  expect(doc.parts[0]).toBe(prose);
  expect(doc.references.map((r) => r.id)).toEqual([12317607]);
  // An id the snapshot does not know is still a Subject: the kit fallback name, never the digits.
  const [unknown] = subjectDocument([{ id: 99999999 }], nameOf).parts;
  expect(typeof unknown === "string" ? unknown : unknown?.name).toBe("unnamed element");
});

test("names use a grille's mark, fitting size and part, then type, without inventing unknown subjects", () => {
  const base = snapshot as unknown as DuctSnapshot;
  const node = base.nodes[0]!;
  const named = subjectNamer({
    ...base,
    nodes: [
      { ...node, id: 1, kind: "terminal", label: "RV-28", facts: [] },
      {
        ...node,
        id: 2,
        kind: "fitting",
        label: null,
        partType: "Elbow",
        facts: [],
        connectors: [
          { ...node.connectors[0]!, size: "14 x 10", widthIn: 14, heightIn: 10, diameterIn: null },
        ],
      },
      { ...node, id: 3, kind: "terminal", label: null, facts: [], type: "Supply 16×8" },
    ],
  });
  expect(named(1)).toBe("RV-28 grille");
  expect(named(2)).toBe("14×10 elbow");
  expect(named(3)).toBe("Supply 16×8 grille");
  expect(named(99999999)).toBeNull();
});

test("block hover lights all references; token hover/focus narrows and exit restores; press goes; unmount clears", () => {
  const registry = makeAtomRegistry();
  const go = vi.fn();
  const { container, unmount } = render(
    <TestAttention registry={registry}>
      <SubjectTextContext.Provider value={{ doc: "test", nameOf, go }}>
        <SubjectText text="10368760 ends at 12317607:0 facing 12317611:0" />
      </SubjectTextContext.Provider>
    </TestAttention>,
  );
  const block = container.querySelector("[data-subject-text]")!;
  fireEvent.mouseEnter(block);
  expect(registry.get(citation)?.refs.map((r) => Number(r.key.slice(2)))).toEqual([
    ...names.keys(),
  ]);
  const token = screen.getByRole("button", { name: "go to 14×10 duct port 0, reference 2" });
  fireEvent.mouseEnter(token);
  expect(registry.get(citation)?.focus?.key ?? null).toBe("e:12317607");
  fireEvent.mouseLeave(token);
  expect(registry.get(citation)?.focus?.key ?? null).toBeNull();
  fireEvent.focus(token);
  expect(registry.get(citation)?.focus?.key ?? null).toBe("e:12317607");
  fireEvent.click(token);
  expect(go).toHaveBeenCalledExactlyOnceWith(12317607);
  fireEvent.mouseLeave(block);

  unmount();
  expect(registry.get(citation)).toBeNull();
});

test("a shared numbering lights only the subjects this text names", () => {
  const nameOf = (id: number) => (id < 100000 ? `E${id}` : null);
  const body = subjectDocument(["Ends at 10007"], nameOf, [10008, 10009]);
  expect(body.references.map((r) => r.number)).toEqual([1, 2, 3]);
  // The heading names none of the body's subjects: no badge may stand for it.
  expect(subjectDocument(["No loss rule"], nameOf, [], body.references).references).toEqual([]);
  // It names one: that one, with the body's number.
  const heading = subjectDocument(["Fix 10008"], nameOf, [], body.references);
  expect(heading.references).toEqual([{ id: 10008, name: "E10008", number: 2 }]);
});
