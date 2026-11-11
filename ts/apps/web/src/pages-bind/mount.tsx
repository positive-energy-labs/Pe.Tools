import { harnessThreadSummarySchema } from "@pe/agent-contracts";
import { useState } from "react";
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
  const [reading, setReading] = useState<PageTargetReading | null>(null),
    [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const read = () =>
    ctx
      .write("read")
      .run()
      .then((value) => setReading(value as PageTargetReading));
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
        onClick={() =>
          void read().catch((error) => setOutcome({ ok: false, message: String(error) }))
        }
      >
        Read binding
      </Button>
      {!ctx.value.current && <p role="status">{ctx.value.reason}</p>}
      <BindPicker
        slug={slug}
        reading={reading?.page === slug ? reading : null}
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
