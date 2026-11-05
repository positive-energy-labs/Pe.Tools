import { type Machine } from "@pe/agent-contracts";
import { routeFromGraph, mountRoute, type RouteAdapters, type MountBody } from "#/shell/mount";
import { ListView } from "@pe/kit/lang/list-view";
import { useList } from "@pe/kit/lang/collection";
import { Button } from "@pe/kit/lang/button";
import { OpenOwnerContext, openControlAdapters } from "../open/kernel";
import { keyOf } from "#/machine/session";
import { lifecycleRequest } from "../open/lifecycle";
import { readingList } from "#/shell/mount-reading";
import type { ReadingState } from "#/shell/readings";
import { sessionsGraph } from "./graph";
import type { OpenPageState } from "../open/graph";
type Page = OpenPageState;
function Sessions({ owner, page, verbs }: MountBody<Page, unknown>) {
  const reading = owner.readings.get("machine") as ReadingState<Machine>;
  const machine = reading.value ?? reading.previous;
  const sessions = readingList(reading, (value) => value.revit.sessions);
  const rows = sessions.items;
  const list = useList({ ...sessions, keyOf, followSelection: { key: page.session || null }, search: (row) => ({ text: [keyOf(row), String(row.row.year)] }), select: "single", onPick: (row) => owner.view.setPage({ session: keyOf(row) }) });
  const selected = rows.find((row) => keyOf(row) === page.session);
  return <><a href={`/open?draft=${encodeURIComponent(JSON.stringify({ ...page.draft, target: page.session }))}`}>Open a document in this session</a>
    <ListView list={list} aria-label="Sessions" row={(row) => ({ label: keyOf(row), sub: `Revit ${row.row.year}`, active: keyOf(row) === page.session })} empty={{ message: sessions.failure ?? "No running sessions", exit: "Start Revit" }} />
    {selected && <section aria-label="Session detail"><p>{keyOf(selected)} · Revit {selected.row.year}</p>{["stop", "restart"].map((id) => { let request: unknown; let refusal: string | null = null; try { request = lifecycleRequest(id === "stop" ? "stop" : "restart", selected, "keep").input; } catch (error) { refusal = String(error); } return <Button key={id} label={id} refusal={refusal} onClick={() => void owner.control(id, { request, refusal }).run()}>{id}</Button>; })}</section>}
    {(machine?.revit.years ?? []).map((year) => <div key={year}>{verbs({ request: { year: String(year), owner: "you", addins: "on" }, refusal: null })}</div>)}
  </>;
}
export const sessionsAdapters: RouteAdapters<Page, unknown> = { ...openControlAdapters, verbDepends: { start: ["machine"], stop: ["machine"], restart: ["machine"] }, wrap: (owner, children) => <OpenOwnerContext value={owner}>{children}</OpenOwnerContext>, bodies: { sessions: (body) => <Sessions {...body} /> } };
export const sessionsRoute = routeFromGraph(sessionsGraph, sessionsAdapters, "/session-admin");
export const SessionsRoute = mountRoute(sessionsGraph, sessionsAdapters);
