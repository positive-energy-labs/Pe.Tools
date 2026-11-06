import { createContext, useContext, useSyncExternalStore } from "react";
import { canonicalRouteInput, decodePageField, type RouteGraph } from "@pe/agent-contracts";

type Declaration = Pick<RouteGraph<any, any>, "fields" | "subjectField" | "name">;
export type SubjectState = Readonly<{
  ready: boolean;
  refusal: string | null;
  label: string;
  link?: string | null;
}>;
const waiting: SubjectState = Object.freeze({ ready: false, refusal: null, label: "" });
type SubjectReader = {
  current(): boolean;
  read(search: Record<string, unknown>): SubjectState | null;
  subscribe(notify: () => void): () => void;
};
// This index owns no declaration, roster or subject value. A mount supplies a read and withdraws it.
const readers = new Map<string, Set<SubjectReader>>();
const listeners = new Set<() => void>();
let revision = 0;
export const subjectScopeKey = (search: Record<string, unknown>) =>
  canonicalRouteInput([search.target ?? null, search.work ?? null, search.fixture ?? null]);
function changed() {
  revision++;
  for (const notify of listeners) notify();
}
export function observeSubject(route: string, reader: SubjectReader) {
  const entries = readers.get(route) ?? new Set<SubjectReader>();
  readers.set(route, entries);
  entries.add(reader);
  const stop = reader.subscribe(changed);
  changed();
  return () => {
    if (!entries.delete(reader)) return;
    stop();
    if (!entries.size && readers.get(route) === entries) readers.delete(route);
    changed();
  };
}
export function useSubjects() {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => revision,
    () => revision,
  );
}
/** Titles and enrollment consult mounted authority, never a route-only declaration or retained roster. */
export function subjectState(route: string, search: Record<string, unknown>): SubjectState {
  for (const reader of [...(readers.get(route) ?? [])].reverse()) {
    if (!reader.current()) continue;
    const state = reader.read(search);
    if (state) return state;
  }
  return waiting;
}

/** Active legacy owners project the same display contract until their production migration. */
export function legacySubjectState(
  graph: Declaration,
  search: Record<string, unknown>,
  roster?: { current: boolean; value?: unknown; error?: string },
): SubjectState {
  const subject = graph.subjectField;
  if (!subject) return waiting;
  const field = graph.fields[subject.field]!;
  const { decoded } = decodePageField(field, search, subject.field);
  if (!decoded.success)
    return {
      ready: false,
      refusal: `${subject.noun} ${JSON.stringify(search[subject.field])} is malformed`,
      label: "",
    };
  const value = decoded.data;
  const ids: string[] = value === "all" ? [] : Array.isArray(value) ? value : value ? [value] : [];
  if (field.picker && !roster?.current && (ids.length || value === "all"))
    return { ready: false, refusal: roster?.error ?? null, label: "" };
  const options = roster?.current ? field.picker?.options(roster.value) : undefined;
  const unknown = options && ids.find((id) => !options.some((option) => option.id === id));
  const named = subject.keyKind !== "UniqueId";
  if (unknown)
    return {
      ready: false,
      refusal: named
        ? `${subject.noun} ${unknown} not in this model`
        : `A ${subject.noun} in this link is not in this model; choose it again from the roster`,
      label: "",
    };
  const labels = ids.map(
    (id) => options?.find((option) => option.id === id)?.label ?? (named ? subject.show(id) : null),
  );
  return {
    ready: true,
    refusal: null,
    label:
      value === "all"
        ? `All ${subject.noun}s`
        : labels.every((label) => label !== null)
          ? labels.join(" + ")
          : `${ids.length} ${subject.noun}${ids.length === 1 ? "" : "s"}`,
  };
}

/** A refused subject never becomes input to the next roster pick. Wait for a current roster. */
export function admittedSubject(
  graph: Declaration,
  page: Record<string, unknown>,
  roster?: unknown,
) {
  const subject = graph.subjectField;
  if (!subject) return null;
  const field = graph.fields[subject.field]!;
  const raw = page[subject.field];
  const { decoded } = decodePageField(field, page, subject.field);
  if (!decoded.success)
    return {
      patch: { [subject.field]: field.schema.parse(undefined) },
      refusal: `${subject.noun} ${JSON.stringify(raw)} is malformed`,
    };
  if (!field.picker || roster === undefined || decoded.data === "all") return null;
  const options = field.picker.options(roster);
  const ids = Array.isArray(decoded.data) ? decoded.data : decoded.data ? [decoded.data] : [];
  const refused = ids.filter((id) => !options.some((option) => option.id === id));
  if (!refused.length) return null;
  const kept = ids.filter((id) => !refused.includes(id));
  return {
    patch: {
      [subject.field]:
        field.cardinality === "many" ? kept : (kept[0] ?? field.schema.parse(undefined)),
    },
    refusal:
      subject.keyKind === "UniqueId"
        ? `Dropped ${refused.length} ${subject.noun} link${refused.length === 1 ? "" : "s"} not in this model`
        : `${subject.noun} ${refused.join(", ")} not in this model`,
  };
}

/** What a pane body may do to the subject: open, close and add, through the one subject field the
 * header writes. Exception to "panes receive PagePort and declared verbs" (`FieldControls`,
 * route-kernel-page.ts): kaitpw 2026-11-03 ruled a subject's list rows and go-to open subjects.
 * The boundary that holds: no pane keeps its own selection; every move lands in the subject field. */
export interface AdmittedSubject {
  all(): void;
  clear(): void;
  toggle(id: unknown): void;
  add(ids: readonly unknown[]): void;
  remove(id: unknown): void;
  setActive(id: unknown): void;
}
export const SubjectDoor = createContext<AdmittedSubject | null>(null);
export const useAdmittedSubject = () => useContext(SubjectDoor);
