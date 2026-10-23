import { expect, test, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { groupTree } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import saved from "./fixtures/synthetic-snapshot.json";
import { ruleFanOut } from "./inputs";

const snapshot = () => structuredClone(saved) as DuctSnapshot;

test("fan-out reuses unchanged document-wide rules across scope visits without scanning or walking", () => {
  const raw = snapshot();
  const rules = new Map([
    [10, "trunk"],
    [21, "trunk"],
    [22, "branch"],
    [999, "absent"],
    [1, "equipment"],
  ]);
  const tree = groupTree(raw, "g10");
  const nodes = vi.spyOn(raw.nodes, Symbol.iterator);
  const segments = vi.spyOn(raw.segments, Symbol.iterator);
  const children = vi.spyOn(tree.children, "get");
  const entries = vi.spyOn(rules, Symbol.iterator);
  try {
    const trunk = ruleFanOut(raw, rules, "trunk");
    expect(trunk).toEqual({ grilles: 2, systems: 1 });
    expect(children).toHaveBeenCalled();
    nodes.mockClear();
    segments.mockClear();
    expect(ruleFanOut(raw, rules, "branch")).toEqual({ grilles: 1, systems: 1 });
    expect(nodes).not.toHaveBeenCalled();
    expect(segments).not.toHaveBeenCalled();
    children.mockClear();
    entries.mockClear();
    expect(ruleFanOut(raw, rules, "trunk", new Map())).toBe(trunk);
    expect(children).not.toHaveBeenCalled();
    expect(entries).not.toHaveBeenCalled();
    expect(ruleFanOut(raw, rules, "absent")).toEqual({ grilles: 0, systems: 0 });
    expect(ruleFanOut(raw, rules, "equipment")).toEqual({ grilles: 0, systems: 0 });
    expect(ruleFanOut(raw, rules, "unknown")).toEqual({ grilles: 0, systems: 0 });
  } finally {
    nodes.mockRestore();
    segments.mockRestore();
    children.mockRestore();
    entries.mockRestore();
  }
});

test("fan-out invalidates independently for snapshot and rule-map identities", () => {
  const raw = snapshot();
  const rules = new Map([[10, "rule"]]);
  const original = ruleFanOut(raw, rules, "rule");
  const equalSnapshot = snapshot();
  expect(ruleFanOut(equalSnapshot, rules, "rule")).toEqual(original);
  expect(ruleFanOut(equalSnapshot, rules, "rule")).not.toBe(original);
  const equalRules = new Map(rules);
  expect(ruleFanOut(raw, equalRules, "rule")).toEqual(original);
  expect(ruleFanOut(raw, equalRules, "rule")).not.toBe(original);
  const changed = {
    ...raw,
    nodes: raw.nodes.map((node) => (node.id === 31 ? { ...node, kind: "cap" as const } : node)),
  };
  expect(ruleFanOut(changed, rules, "rule")).toEqual({ grilles: 1, systems: 1 });
  expect(ruleFanOut(raw, new Map([[30, "rule"]]), "rule")).toEqual({ grilles: 1, systems: 1 });
  expect(ruleFanOut(raw, rules, "rule")).toBe(original);
});

test("saved terminal membership survives repeated visits and invalidates after topology replacement", () => {
  const raw: DuctSnapshot = process.env.PE_DUCTS_CACHE_FIXTURE
    ? JSON.parse(readFileSync(process.env.PE_DUCTS_CACHE_FIXTURE, "utf8"))
    : snapshot();
  const terminals = raw.nodes.filter((node) => node.kind === "terminal" && node.groupId);
  expect(terminals.length).toBeGreaterThan(0);
  const rules = new Map(terminals.map((node) => [node.id, "terminals"]));
  const original = ruleFanOut(raw, rules, "terminals");
  expect(original).toEqual({
    grilles: terminals.length,
    systems: new Set(terminals.map((node) => node.groupId)).size,
  });
  expect(ruleFanOut(raw, rules, "terminals")).toBe(original);
  const changed = {
    ...raw,
    nodes: raw.nodes.map((node) =>
      node.kind === "terminal" ? { ...node, kind: "cap" as const } : node,
    ),
  };
  expect(ruleFanOut(changed, rules, "terminals")).toEqual({
    grilles: 0,
    systems: original.systems,
  });
  expect(ruleFanOut(raw, new Map(), "terminals")).toEqual({ grilles: 0, systems: 0 });
  expect(ruleFanOut(raw, rules, "terminals")).toBe(original);
});
