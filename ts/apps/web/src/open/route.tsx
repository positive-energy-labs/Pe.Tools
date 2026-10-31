import type { ReadingState } from "#/shell/readings";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HarnessThreadSummary, Machine } from "@pe/agent-contracts";
import { mountRoute, routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { Scroll } from "@pe/kit/lang/scroll";
import { PatchBay, type BayLayout } from "./bay";
import { openGraph, type OpenPageState } from "./graph";
import { OpenOwnerContext, openControlAdapters } from "./kernel";
import { modelRows } from "./model";
import type { Recents } from "./sources";
function BayBody({ owner }: MountBody<OpenPageState, unknown>) {
  const container = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<BayLayout>("stack");
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const minimum = 64 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const measure = () =>
      setLayout(node.getBoundingClientRect().width >= minimum ? "row" : "stack");
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);
  const reading = owner.readings.get("machine") as ReadingState<Machine>;
  const machine = reading.value ?? reading.previous ?? null;
  const recentReading = owner.readings.get("recents") as ReadingState<Recents>;
  const recents = (recentReading.value ?? recentReading.previous)?.result?.recents ?? [];
  const rows = useMemo(() => modelRows(machine?.revit.sessions ?? [], recents), [machine, recents]);
  const threadReading = owner.readings.get("threads") as ReadingState<
    readonly HarnessThreadSummary[]
  >;
  const threads = threadReading.value ?? threadReading.previous ?? null;
  return (
    <Scroll
      ref={container}
      className="min-h-0 min-w-0 flex-1"
      fieldClassName="gap-2"
      data-testid="open-route"
      aria-busy={!reading.current && reading.status !== "failed"}
    >
      <p className="m-0 text-ink-2">
        {layout === "stack"
          ? "Choose a document and a Revit below."
          : "Documents on the left, Revits on the right."}{" "}
        Pick a document, patch it into a Revit, and press the one verb that names what happens.
      </p>
      <PatchBay
        machine={machine}
        loading={!machine && ["absent", "pending"].includes(reading.status)}
        refusal={reading.current ? null : "Refresh the machine reading before changing Revit"}
        rows={rows}
        threads={threads}
        fixture={!!owner.fixture}
        layout={layout}
      />
    </Scroll>
  );
}
export const openAdapters: RouteAdapters<OpenPageState, unknown> = {
  ...openControlAdapters,
  wrap: (owner, children) => <OpenOwnerContext value={owner}>{children}</OpenOwnerContext>,
  bodies: { bay: (body) => <BayBody {...body} /> },
};
export const openRoute = routeFromGraph(openGraph, openAdapters, "/open");
export const OpenPage = mountRoute(openGraph, openAdapters);
