import { refusalOf } from "#/route/typed-route";
import { actionScopeKeys, useScopeKeys } from "@pe/kit/keys";
import { useEffect, useState } from "react";
import { routeAddress, canonicalRouteInput } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { EmptyState } from "@pe/kit/lang/empty";
import { useList } from "@pe/kit/lang/collection";
import { PlainList } from "@pe/kit/lang/list-view";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Ladder } from "../route/ladder";
import { AdoptRegions, type AdoptionStore } from "./adopt-panel";
import { TakeoffKernel } from "./kernel-context";
import { viewCatalogue, type AdoptionContext } from "./route";

export function AdoptionBody({ ctx }: { ctx: AdoptionContext }) {
  const data = ctx.value.value;
  const savedZones = useList({
    value: ctx.value,
    rowsOf: (value) => value.saved?.snapshot.world.zones ?? [],
    keyOf: (row) => row.zone.guid,
    search: (row) => ({ text: [row.name, row.zone.lane.label, row.zone.declaredSqft, row.stage] }),
    select: "none",
  });
  const page = ctx.page.read();
  const catalogue = ctx.read(viewCatalogue);
  // A second reading: the body narrows it. The view options it last held stay choosable to read, not to pick.
  const views = "value" in catalogue ? catalogue.value : undefined;
  const viewsReading = catalogue.state === "reading" || catalogue.state === "refreshing";
  const viewNote = catalogue.state === "ready" ? undefined : viewsReading
    ? views ? "Reading views; showing the last known catalogue" : "Reading views..."
    : `View catalogue unavailable: ${refusalOf(catalogue)}${views ? "; showing the last known catalogue" : ""}`;
  const selectedViews = page.views === "all"
    ? views?.viewOptions.map((row) => row.id) ?? [] : page.views;
  const [pending, setPending] = useState<{ id: "initialize" | "adopt"; request: unknown } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  // This is a pending gesture, not authored Work: the host must publish the staged intent before its action runs.
  useEffect(() => {
    if (!pending || ctx.value.state !== "ready" || ctx.cells.state.state !== "ready") return;
    const entry = `takeoffs.${pending.id}`;
    const authored = ctx.cells.doc?.writeIntent?.[entry]?.edit?.value;
    if (canonicalRouteInput(authored) !== canonicalRouteInput(pending.request)) return;
    if (
      canonicalRouteInput(ctx.value.value?.[pending.id].request) !==
      canonicalRouteInput(pending.request)
    ) {
      setPending(null);
      setProblem("Adoption choices changed; prepare the current rows again");
      return;
    }
    const { id } = pending;
    setPending(null);
    const action = ctx.write(id);
    void (async () => {
      if (id === "adopt") {
        await action.plan();
        await action.apply();
      } else await action.run();
    })().catch((error) => setProblem(String(error)));
  }, [pending, ctx.value, ctx.cells.state.state]);
  const stage = async (id: "initialize" | "adopt") => {
    if (!data) return;
    const request = data[id].request;
    setProblem(null);
    const failure = await ctx.cells.patch(
      [{ path: ["writeIntent", `takeoffs.${id}`, "edit"], value: { value: request } }],
      { label: `Prepare ${id}` },
    );
    if (failure) setProblem(failure.message);
    else setPending({ id, request });
  };
  const observation = data?.observation;
  const snapshot =
    data?.saved?.snapshot ??
    (observation?.kind === "ready"
      ? observation.capture.snapshot
      : observation && "previous" in observation
        ? observation.previous?.snapshot
        : undefined);
  const frozen = !!page.work;
  const store: AdoptionStore = {
    views: data?.views ?? [],
    world: snapshot?.world ?? { zones: [] },
    adoptRows: data?.rows ?? null,
    cells: { adopt: data?.takeoffWork.adopt ?? {} },
    wires: {
      adopt: {
        segment: "adopt",
        revision: data?.handle?.revision ?? null,
        write: async (patches, expectedRevision) => {
          if (frozen) return { code: "read-only", message: "Saved captures are inspection only" };
          if (expectedRevision !== undefined && expectedRevision !== data?.handle?.revision)
            return { code: "stale", message: "Work changed; read the current adoption choices" };
          return ctx.cells.patch(patches, { label: "Edit adoption choices" });
        },
      },
    },
    candidatesReading: ctx.value.state === "refreshing",
    candidatesIssue: ctx.value.state === "stale" ? Error(refusalOf(ctx.value)!) : null,
    actions: {
      patchAdopt(view, elementId, patch) {
        const row = data?.rows.find(
          (row) => row.view === view && row.region.elementId === elementId,
        );
        if (!row || frozen) return;
        void ctx.cells
          .at(["adopt", `${view}:${elementId}`])
          .stage(
            { checked: row.checked, name: row.name, systemTag: row.systemTag, ...patch },
            { label: "Edit adoption choice" },
          )
          .then((failure) => {
            if (failure) setProblem(failure.message);
          });
      },
    },
  };
  useScopeKeys(
    actionScopeKeys([
      {
        id: "takeoffs.adopt",
        label: "Adopt",
        bindings: ["Mod+Shift+A"],
        available: () =>
          !frozen && ctx.value.state === "ready" && ctx.cells.state.state === "ready" && !pending && !data?.adopt.refusal,
        invoke: () => {
          void stage("adopt");
        },
      },
    ]),
  );
  return (
    <>
      <nav aria-label="Takeoff siblings">
        <a
          href={routeAddress("takeoffs").link(
            { views: page.views, zones: page.zones, work: page.work, r10: page.r10 },
            ctx.target?.kind === "document" ? { target: JSON.stringify(ctx.target.ref) } : {},
          )}
        >
          View adoption
        </a>
      </nav>
      {data?.unreadable?.map((blob, index) => (
        <OutcomeLine key={index} kind="refused" label="can't read, kept"
          says={`${blob.parameter} / ${blob.elementId == null ? "Project Information" : "Element name unavailable"}: ${blob.reason}`} />
      ))}
      {problem && <OutcomeLine kind="error" label="Adoption" says={problem} />}
      {frozen ? (
        <>
          <p>
            Archived takeoff · {data?.saved?.capturedAt ?? "Reading saved capture…"} ·{" "}
            {data?.saved?.provenance.target.session} / {data?.saved?.provenance.target.openId}
          </p>
          {data?.saved && <section aria-label="Saved takeoff contents">
            <p>This capture stores takeoff data, not a view image.</p>
            {data.saved.snapshot.world.zones.length === 0 ?
              <EmptyState story="scope" exit="Return to live, choose views and adopt zoning regions">No adopted zones in this saved takeoff</EmptyState> :
              <PlainList
                list={savedZones}
                aria-label="Saved takeoff zones"
                empty={{ message: "No adopted zones in this saved takeoff", exit: "Return to live, choose views and adopt zoning regions" }}
                row={(row) => ({ label: `${row.name} / ${row.zone.lane.label} / ${row.zone.declaredSqft} sf / ${row.stage}` })}
              />}
          </section>}
          <Button kind="quiet" label="live" onClick={() => ctx.page.query({ work: "" })}>
            live
          </Button>
        </>
      ) : (
        <Ladder
          header={viewNote && views ? <p role={viewsReading ? "status" : "alert"}>{viewNote}</p> : undefined}
          levels={[
            {
              key: "views",
              label: selectedViews.length ? `${selectedViews.length} views` : null,
              placeholder: "choose views",
              options: views?.viewOptions.map((row) => ({ ...row,
                ...(catalogue.state !== "ready" ? { refusal: viewNote } : {}),
              })) ?? null,
              note: viewNote,
              multi: true,
              picked: (id) => selectedViews.includes(id),
              pick: (id) => {
                if (catalogue.state !== "ready") return;
                const views = selectedViews;
                setPending(null);
                ctx.page.query({
                  views: views.includes(id) ? views.filter((view) => view !== id) : [...views, id],
                  zones: [],
                });
              },
            },
          ]}
        />
      )}
      <Ladder
        levels={[
          {
            key: "capture",
            label: data?.captures.find((row) => row.id === page.work)?.title || null,
            placeholder: "saved captures",
            options:
              data?.captures.map((row) => ({
                id: row.id,
                label: row.title || row.id,
                sub: row.capturedAt,
              })) ?? null,
            note: ctx.value.state === "refreshing" ? "Reading saved captures..." : refusalOf(ctx.value) ?? undefined,
            picked: (id) => id === page.work,
            pick: (work) => {
              setPending(null);
              ctx.page.query({ work });
            },
          },
        ]}
      />
      {!frozen && (
        <>
          <Button label="refresh" onClick={() => ctx.refresh()}>
            refresh
          </Button>
          {(["initialize", "adopt"] as const).map((id) => (
            <Button
              key={id}
              label={id}
              busy={pending?.id === id || ctx.write(id).pending}
              refusal={
                pending
                  ? "Preparing Work"
                  : (refusalOf(ctx.value) ?? data?.[id].refusal ?? refusalOf(ctx.cells.state))
              }
              onClick={() => void stage(id)}
            >
              {id}
            </Button>
          ))}
          <TakeoffKernel value={null}>
            <AdoptRegions store={store} />
          </TakeoffKernel>
        </>
      )}
    </>
  );
}
