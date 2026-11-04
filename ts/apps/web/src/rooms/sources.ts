import { z } from "zod";
import { actionReceiptSchema } from "@pe/agent-contracts";
import type { RoomsSnapshot, RevitContextViewImage } from "@pe/host-contracts/generated";
import { callOp, opSource } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource, UseSource } from "#/shell/readings";
import type { TakeoffPlanImage } from "#/takeoff/level-plan";
import type { PlanRefusal } from "#/takeoff/plan";
import { NO_TRACE, type TraceRead } from "./layers";
import type { RoomsPage } from "./graph";

export type PlanReading = { plan: TakeoffPlanImage } | { refusal: PlanRefusal } | null;
const page = (ctx: ReadingContext) => ctx.page as RoomsPage;

/** Only the source listens for focus; its deliveries remain fenced by the kernel attempt. */
export function roomsSnapshotSource(): UseSource<RoomsSnapshot.Res.Response | null> {
  return {
    kind: "use",
    dirties: ["rooms", "snapshot"],
    open(ctx, deliver) {
      if (ctx.target.kind !== "document")
        return deliver({ kind: "complete", value: null, revision: 0 });
      let serial = 0;
      let latest = 0;
      const read = async () => {
        const attempt = ++latest;
        deliver({ kind: "stale" });
        try {
          const value = page(ctx).view
            ? await callOp(ctx, "rooms.snapshot", { view: page(ctx).view })
            : await callOp(ctx, "rooms.roster", {});
          if (!ctx.signal.aborted && attempt === latest)
            deliver({ kind: "complete", value, revision: ++serial });
        } catch (error) {
          if (!ctx.signal.aborted && attempt === latest) deliver({ kind: "failure", error });
        }
      };
      const refresh = () => {
        void read();
      };
      refresh();
      window.addEventListener("focus", refresh);
      return () => window.removeEventListener("focus", refresh);
    },
  };
}

/** The image and registration are a pair; malformed native frames never draw plausible geometry. */
export function planOf(response: RevitContextViewImage.Res.Response): Exclude<PlanReading, null> {
  if (response.registration && response.imageUrl) {
    const corner = (p: number[]): [number, number] => {
      if (p.length !== 2 || !p.every(Number.isFinite))
        throw Error(`view-image registration corner is not model XY: [${p.join(", ")}]`);
      return [p[0]!, p[1]!];
    };
    return {
      plan: {
        href: response.imageUrl,
        registration: {
          ...response.registration,
          topLeft: corner(response.registration.topLeft),
          topRight: corner(response.registration.topRight),
          bottomLeft: corner(response.registration.bottomLeft),
        },
      },
    };
  }
  if (response.registration || response.imageUrl)
    throw Error(
      "view-image carried an image URL and a registration apart; the contract pairs them",
    );
  if (!response.registrationRefusal)
    throw Error("view-image carried no registration and no refusal naming why");
  return { refusal: response.registrationRefusal };
}

export function roomsSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "rooms.roster": opSource({ key: "rooms.roster", request: ({ target }) => target.kind === "document" ? {} : null, absent: null }),
    "rooms.snapshot": roomsSnapshotSource(),
    "rooms.trace": {
      kind: "use",
      dirties: ["rooms", "snapshot"],
      async open(ctx, deliver) {
        if (ctx.target.kind !== "document" || !page(ctx).view)
          return deliver({ kind: "complete", value: { data: null, none: null }, revision: 0 });
        try {
          const data = await callOp(ctx, "rooms.trace", { view: page(ctx).view! });
          deliver({
            kind: "complete",
            value: { data, none: null } satisfies TraceRead,
            revision: 1,
          });
        } catch (error) {
          if (ctx.signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          if (NO_TRACE.test(message))
            deliver({
              kind: "complete",
              value: { data: null, none: "no trace for this view" },
              revision: 1,
            });
          else deliver({ kind: "failure", error });
        }
      },
    },
    // Re-export only when the target/view changes; room writes leave the expensive underlay alone.
    "rooms.plan": opSource({
      key: "revit.context.view-image",
      dirties: ["rooms-plan"],
      absent: null as PlanReading,
      request: (ctx) =>
        ctx.target.kind === "document" && page(ctx).view
          ? { target: { name: page(ctx).view! }, pixelSize: 8000 }
          : null,
      map: planOf,
    }),
    "rooms.receipts": subscriptionSource({
      request: (ctx) => ({
        kind: "receipts",
        ...(ctx.target.kind === "document" ? { target: ctx.target.ref } : {}),
      }),
      decode: (value) => z.array(actionReceiptSchema).parse(value),
      dirties: ["rooms", "receipts"],
    }),
  };
}
