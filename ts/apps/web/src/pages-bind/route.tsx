import type { HarnessThreadSummary, PageTargetReading } from "@pe/agent-contracts";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";
import { inventoryOf } from "#/readings";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { routeFromGraph, type RouteAdapters, type MountBody } from "#/shell/mount";
import { bindGraph, type BindPage } from "./graph";
import { bindSources } from "./sources";
import { BindPicker } from "#/pages-bind/picker";

function Body({ owner, page }: MountBody<BindPage, never>) {
  if (page.view)
    return (
      <iframe
        className="size-full flex-1"
        title={`Page ${page.page}`}
        src={`/pages/${encodeURIComponent(page.page)}/${page.query ? `?${new URLSearchParams(page.query)}` : ""}${page.fragment ? `#${page.fragment}` : ""}`}
      />
    );
  const target = owner.readings.get("target");
  const threads = owner.readings.get("threads");
  const inventory = owner.readings.get("inventory");
  const seen = (inventory.value ?? inventory.previous) as
    | { sessions: BridgeSessionListEntry[] }
    | undefined;
  const result = owner.results.get("bind");
  const error = [target, threads, inventory].find((read) => read.status === "failed")?.error;
  return (
    <>
      {error ? <OutcomeLine kind="error" label="Binding unread" says={error} /> : null}
      <BindPicker
        slug={page.page}
        reading={(target.value ?? target.previous ?? null) as PageTargetReading | null}
        threads={(threads.value ?? threads.previous ?? null) as HarnessThreadSummary[] | null}
        documents={
          seen
            ? inventoryOf(seen.sessions).flatMap((session) =>
                (session.openDocuments ?? []).map((doc) => ({
                  title: doc.title,
                  address: doc.address ?? null,
                  revit: `Revit ${session.year ?? ""} / pid ${session.processId}`,
                  ref: { session: session.sessionId, openId: doc.openId },
                })),
              )
            : null
        }
        outcome={
          result?.state === "done"
            ? { ok: true, message: "Bound. The Page's chip follows within 5 s." }
            : result && "refusal" in result
              ? { ok: false, message: result.refusal.message }
              : null
        }
        onBind={(choice) => {
          void owner.control("bind", choice).run();
        }}
      />
    </>
  );
}
export const bindAdapters: RouteAdapters<BindPage, never> = {
  sources: bindSources(),
  subjects: {},
  binding: (_, row) => ({ subject: null, args: row ?? { kind: "none" } }),
  bodies: { page: (body) => <Body {...body} /> },
};
export const bindRoute = routeFromGraph(bindGraph, bindAdapters, "/bind");
