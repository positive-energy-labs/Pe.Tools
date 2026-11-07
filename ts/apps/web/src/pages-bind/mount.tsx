import { harnessThreadSummarySchema } from "@pe/agent-contracts";
import { useState } from "react";
import type { PageTargetReading, PageChoice } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { inventoryOf } from "../host/resource-state";
import { BindPicker } from "./bind-picker";
import type { BindContext } from "./route";
export function BindBody({ ctx }: { ctx: BindContext }) {
  const page = ctx.page.read(),
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
        title={`Page ${page.page}`}
        src={`/pages/${encodeURIComponent(page.page)}/?${new URLSearchParams(page.query)}${page.fragment ? `#${page.fragment}` : ""}`}
      />
    );
  return (
    <>
      <label>
        Page
        <Input
          aria-label="Page slug"
          value={page.page}
          onChange={(event) => {
            ctx.page.query({ page: event.target.value });
            setReading(null);
          }}
        />
      </label>
      <Button
        label="Read current binding"
        refusal={!page.page ? "Choose a Page" : null}
        onClick={() =>
          void read().catch((error) => setOutcome({ ok: false, message: String(error) }))
        }
      >
        Read binding
      </Button>
      {!ctx.value.current && <p role="status">{ctx.value.reason}</p>}
      <BindPicker
        slug={page.page}
        reading={reading?.page === page.page ? reading : null}
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
