import { scopeOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Members, SubjectKey } from "@pe/kit/lang/attention";
import type { ElementIndex } from "../element-index";
import { z } from "zod";
import type { CellRef } from "./inbox-rows";

const address = z.tuple([
  z.literal("cell"),
  z.enum(["flows", "terminalDrops", "equipmentFlows", "esp", "roles", "componentDrops"]),
  z.coerce.number().int().positive(),
  z.enum(["inputs", "this", "all"]),
]);

/** A cell jump is a semantic selection, retained even when its pane is absent. */
export function cellFocusSubject(
  snapshot: DuctSnapshot,
  systems: readonly string[],
  cell: CellRef,
) {
  const pane =
    cell.segment === "componentDrops"
      ? scopeOf(snapshot, systems)?.members.has(cell.id)
        ? "this"
        : "all"
      : "inputs";
  return `cell:${cell.segment}:${cell.id}:${pane}`;
}

/** Local identities carry opaque text; decode its cell meaning at this boundary once. */
export function cellFocusOf(subject: string) {
  const decoded = address.safeParse(subject.split(":"));
  return decoded.success
    ? { segment: decoded.data[1], id: decoded.data[2], pane: decoded.data[3], key: subject }
    : null;
}

/*
 * The selection holds SubjectKeys only (ADR 0035 rule 2): an element is its SubjectRef, never an
 * ElementId string; a cell, rule or issue is a route attention place `<kind>:<key>`. A selected
 * cell lights its element because the route declares it as the cell's one member, not because a
 * bridge rewrites the selection.
 */
export const selectedKeys = (ids: readonly string[]): SubjectKey[] =>
  ids.filter((id): id is SubjectKey => id.includes(":"));

/** The element a selected element or cell names; null for any other place. */
export function focusedElement(subject: string, elements: ElementIndex): number | null {
  const id = cellFocusOf(subject)?.id ?? elements.idOf(subject);
  return Number.isFinite(id) ? id : null;
}

/** A picked issue is the place `issue:<key>`; the marks and rows key on the bare key. */
export const issueSubject = (key: string): SubjectKey => `issue:${key}`;
export const issueOf = (selected: string) => (selected.startsWith("issue:") ? selected.slice(6) : "");

/** Each selected cell's one member: its element. */
export const cellMembers = (selected: readonly SubjectKey[], elements: ElementIndex): Members =>
  new Map(
    selected.flatMap((key) => {
      const cell = cellFocusOf(key);
      const element = cell ? elements.keyOf(cell.id) : null;
      return element ? [[key, [element]] as const] : [];
    }),
  );
