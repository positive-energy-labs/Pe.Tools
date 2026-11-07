import { actionScopeKeys, useScopeKeys } from "@pe/kit/keys";
import { useEffect, useState } from "react";
import { routeAddress, canonicalRouteInput } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Ladder } from "../route/ladder";
import { AdoptRegions, type AdoptionStore } from "./adopt-panel";
import { TakeoffKernel } from "./kernel-context";
import { loaded, type AdoptionContext } from "./route";

export function AdoptionBody({ ctx }: { ctx: AdoptionContext }) {
  const data = ctx.value.value;
  const page = ctx.page.read();
  const [pending, setPending] = useState<{ id: "initialize" | "adopt"; request: unknown } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  // This is a pending gesture, not authored Work: the host must publish the staged intent before its action runs.
  useEffect(() => {
    if (!pending || !ctx.value.current || !ctx.cells.ready) return;
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
  }, [pending, ctx.value, ctx.cells.ready]);
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
    candidatesReading: ctx.value.status === "pending",
    candidatesIssue:
      !ctx.value.current && ctx.value.status !== "pending" ? Error(ctx.value.reason) : null,
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
          !frozen && ctx.value.current && ctx.cells.ready && !pending && !data?.adopt.refusal,
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
      {!ctx.value.current && (
        <OutcomeLine
          kind={ctx.value.status === "pending" ? "busy" : "error"}
          label="Takeoff reading"
          says={ctx.value.reason}
        />
      )}
      {problem && <OutcomeLine kind="error" label="Adoption" says={problem} />}
      {frozen ? (
        <>
          <p>
            Archived takeoff · {data?.saved?.capturedAt ?? "Reading saved capture…"} ·{" "}
            {data?.saved?.provenance.target.session} / {data?.saved?.provenance.target.openId}
          </p>
          <Button label="live" onClick={() => ctx.page.query({ work: "" })}>
            live
          </Button>
        </>
      ) : (
        <Ladder
          levels={[
            {
              key: "views",
              label: data?.views.length ? `${data.views.length} views` : null,
              placeholder: "choose views",
              options: data?.viewOptions ?? [],
              multi: true,
              picked: (id) => data?.views.includes(id) ?? false,
              pick: (id) => {
                const views = data?.views ?? [];
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
              })) ?? [],
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
          <Button label="refresh" onClick={() => ctx.refresh(loaded)}>
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
                  : !ctx.value.current
                    ? ctx.value.reason
                    : (data?.[id].refusal ?? ctx.cells.refusal)
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
