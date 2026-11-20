import {
  harnessThreadSummarySchema,
  pageTargetReadingSchema,
  routeAddress,
} from "@pe/agent-contracts";
import { useEffect, useState } from "react";
import type { PageTargetReading, PageChoice } from "@pe/agent-contracts";
import { inventoryOf } from "../host/resource-state";
import { peReadings } from "../host/resource-stream";
import { BindPicker } from "./bind-picker";
import { PageBindingChip } from "../navigation/chip";
import { useRouteSearch } from "@pe/web-kernel/route/activity";
import { nameOf, oneName } from "@pe/web-kernel/route/typed-route";
import type { BindContext } from "./route";
export function BindBody({ ctx }: { ctx: BindContext }) {
  const page = ctx.page.read(),
    slug = nameOf(page.page),
    data = ctx.value.value;
  const { carry } = routeAddress("bind").read(useRouteSearch());
  // The host names a Page by its key (`page:@<pod>/pages/<page>`), the route by its slug; a reading
  // is kept with the slug it was read for, so one identity is compared in one form.
  const [reading, setReading] = useState<{ slug: string; value: PageTargetReading } | null>(null),
    [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null),
    // D40: the bind in flight. The host lists the Pods before it answers (seconds), and until then
    // the form says so and takes no second press.
    [binding, setBinding] = useState(false);
  // The Page's target is a Reading on the tab's one stream, as the Page chip reads it: the host serves
  // it on arrival and again when the binding moves, so nothing here asks twice.
  useEffect(() => {
    if (!slug || page.view) return;
    return peReadings.subscribe({ kind: "page-target", slug }, (frame) => {
      if (frame.kind === "failure") return setOutcome({ ok: false, message: frame.error });
      if (frame.kind !== "snapshot") return;
      const next = pageTargetReadingSchema.safeParse(frame.value);
      if (next.success) setReading({ slug, value: next.data });
      else setOutcome({ ok: false, message: next.error.message });
    });
  }, [slug, page.view]);
  const bind = async (choice: PageChoice) => {
    setOutcome(null);
    setBinding(true);
    try {
      await ctx.verb("bind").run(choice);
      setOutcome({ ok: true, message: "Bound. The Page chip follows within 5 s." });
    } catch (error) {
      setOutcome({ ok: false, message: String(error) });
    } finally {
      setBinding(false);
    }
  };
  if (page.view)
    return (
      <>
        {/* D9: the viewed Page carries its chip here, the one place it is drawn. A Page's refusal says
            "Bind it from the chip". */}
        <PageBindingChip
          slug={slug}
          query={page.query}
          fragment={page.fragment}
          onBind={() => ctx.page.pose({ view: false }, "named")}
        />
        <iframe
          className="size-full flex-1"
          title={`Page ${slug}`}
          src={`/pages/${encodeURIComponent(slug)}/?${new URLSearchParams(page.query)}${page.fragment ? `#${page.fragment}` : ""}`}
        />
      </>
    );
  return (
    <>
      {/* The kernel draws the Page chooser from the subject slot (pane head); a route draws no second one. */}
      {ctx.value.reason && <p role="status">{ctx.value.reason}</p>}
      <BindPicker
        slug={slug}
        back={routeAddress("bind").link(
          { page: oneName(slug), view: true, query: page.query, fragment: page.fragment },
          carry,
        )}
        reading={reading?.slug === slug ? reading.value : null}
        threads={data ? harnessThreadSummarySchema.array().parse(data.threads) : null}
        documents={
          data
            ? inventoryOf(data.inventory.sessions).flatMap((session) =>
                (session.openDocuments ?? []).map((doc) => ({
                  title: doc.title,
                  address: doc.address ?? null,
                  revit: `Revit ${session.year ?? ""} / pid ${session.processId ?? ""}`,
                  ref: { session: session.sessionId, openId: doc.openId },
                })),
              )
            : null
        }
        outcome={outcome}
        binding={binding}
        // D40: a followed href reloads the document and aborts a bind in flight; the pose keeps it.
        onBack={() => ctx.page.pose({ view: true }, "named")}
        onBind={(choice) => void bind(choice)}
      />
    </>
  );
}
