import { useSyncExternalStore } from "react";
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
  if (unknown)
    return { ready: false, refusal: `${subject.noun} ${unknown} not in this model`, label: "" };
  return {
    ready: !field.picker || !!options || (!ids.length && value !== "all"),
    refusal: null,
    label:
      value === "all"
        ? `All ${subject.noun}s`
        : ids
            .map((id) => options?.find((option) => option.id === id)?.label ?? subject.show(id))
            .join(" + "),
  };
}

/** A refused subject never becomes input to the next roster pick. Wait for a current roster. */
export function admittedSubject(graph: Declaration, page: Record<string, unknown>, roster?: unknown) {
  const subject = graph.subjectField;
  if (!subject) return null;
  const field = graph.fields[subject.field]!;
  const raw = page[subject.field];
  const { decoded } = decodePageField(field, page, subject.field);
  if (!decoded.success) return {
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
    patch: { [subject.field]: field.cardinality === "many" ? kept : kept[0] ?? field.schema.parse(undefined) },
    refusal: `${subject.noun} ${refused.join(", ")} not in this model`,
  };
}
