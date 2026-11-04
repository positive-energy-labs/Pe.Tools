import { createContext, useContext, useSyncExternalStore } from "react";
import { canonicalRouteInput, decodePageField, type RouteGraph } from "@pe/agent-contracts";

type Option = { id: string; label: string };
type Declaration = Pick<RouteGraph<any, any>, "fields" | "subjectField" | "name">;
const declarations = new Map<string, Declaration>();
const rosters = new Map<string, readonly Option[]>();
const listeners = new Set<() => void>();
let revision = 0;
const scopeKey = (route: string, search: Record<string, unknown>) =>
  canonicalRouteInput([route, search.target ?? null, search.work ?? null, search.fixture ?? null]);
export function registerSubject(route: string, graph: Declaration) {
  declarations.set(route, graph);
}
export function publishSubjectRoster(
  route: string,
  search: Record<string, unknown>,
  options: readonly Option[],
) {
  const key = scopeKey(route, search);
  if (canonicalRouteInput(rosters.get(key)) === canonicalRouteInput(options)) return;
  rosters.set(key, options);
  revision++;
  for (const notify of listeners) notify();
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
/** The same subject admission and display projection serves pane heads, Places and window titles. */
export function subjectState(route: string, search: Record<string, unknown>) {
  const graph = declarations.get(route);
  const subject = graph?.subjectField;
  if (!graph || !subject) return { ready: false, refusal: null, label: "" };
  const field = graph.fields[subject.field]!;
  const raw = search[subject.field];
  const { decoded } = decodePageField(field, search, subject.field);
  if (!decoded.success)
    return {
      ready: false,
      refusal: `${subject.noun} ${JSON.stringify(raw)} is malformed`,
      label: "",
    };
  const value = decoded.data;
  const ids: string[] = value === "all" ? [] : Array.isArray(value) ? value : value ? [value] : [];
  const options = rosters.get(scopeKey(route, search));
  const unknown = options && ids.find((id) => !options.some((option) => option.id === id));
  // A UniqueId key (and its port suffix) is never display text: refusals and labels name the noun instead.
  const named = subject.keyKind !== "UniqueId";
  if (unknown)
    return {
      ready: false,
      refusal: named
        ? `${subject.noun} ${unknown} not in this model`
        : `A ${subject.noun} in this link is not in this model; choose it again from the roster`,
      label: "",
    };
  const label = (id: string) =>
    options?.find((option) => option.id === id)?.label ?? (named ? subject.show(id) : null);
  const labels = ids.map(label);
  return {
    ready: !field.picker || !!options || (!ids.length && value !== "all"),
    refusal: null,
    label:
      value === "all"
        ? `All ${subject.noun}s`
        : labels.every((l) => l !== null)
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
  toggle(id: unknown): void;
  add(ids: readonly unknown[]): void;
}
export const SubjectDoor = createContext<AdmittedSubject | null>(null);
export const useAdmittedSubject = () => useContext(SubjectDoor);
