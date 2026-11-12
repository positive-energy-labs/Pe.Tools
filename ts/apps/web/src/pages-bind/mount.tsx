import { harnessThreadSummarySchema } from "@pe/agent-contracts";
import { useEffect, useState } from "react";
import type { PageTargetReading, PageChoice } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { inventoryOf } from "../host/resource-state";
import { BindPicker } from "./bind-picker";
import { nameOf } from "#/route/typed-route";
import type { BindContext } from "./route";
export function BindBody({ ctx }: { ctx: BindContext }) {
  const page = ctx.page.read(),
    slug = nameOf(page.page),
    data = ctx.value.value;
  // The host names a Page by its key (`page:@<pod>/pages/<page>`), the route by its slug; a reading
  // is kept with the slug it was read for, so one identity is compared in one form.
  const [reading, setReading] = useState<{ slug: string; value: PageTargetReading } | null>(null),
    [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const read = () =>
    ctx
      .write("read")
      .run()
      .then((value) => setReading({ slug, value: value as PageTargetReading }));
  const readShown = () =>
    void read().catch((error) => setOutcome({ ok: false, message: String(error) }));
  // A chosen Page is read on arrival; the button re-reads.
  useEffect(() => {
    if (slug && !page.view) readShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per chosen Page
  }, [slug, page.view]);
  const bind = async (choice: PageChoice) => {
    try {
      await ctx.write("bind").run(choice);
      setOutcome({ ok: true, message: "Bound. The Page chip follows within 5 s." });
      await read();
    } catch (error) {
      setOutcome({ ok: false, message: String(error) });
    }
  };
  if (page.view)
    return (
      <iframe
        className="size-full flex-1"
        title={`Page ${slug}`}
        src={`/pages/${encodeURIComponent(slug)}/?${new URLSearchParams(page.query)}${page.fragment ? `#${page.fragment}` : ""}`}
      />
    );
  return (
    <>
      {/* The kernel draws the Page chooser from the subject slot (pane head); a route draws no second one. */}
      <Button
        label="Read current binding"
        refusal={!slug ? "Choose a Page" : null}
        onClick={readShown}
      >
        Read binding
      </Button>
      {!ctx.value.current && <p role="status">{ctx.value.reason}</p>}
      <BindPicker
        slug={slug}
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
        onBind={(choice) => void bind(choice)}
      />
    </>
  );
}
