import { actionStatusSchema,actionReceiptSchema } from "@pe/agent-contracts";
import { useState } from "react";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Code, stringify } from "@pe/kit/lang/code";
import { Button } from "@pe/kit/lang/button";
import { Operation } from "./workspace";
import { outputRenderers } from "./renderers";
import type { OpsContext } from "./route";
export function OpsBody({ ctx }: { ctx: OpsContext }) {
  const page = ctx.page.read(),
    data = ctx.value.value,
    [failure, setFailure] = useState<string | null>(null);
  const list = useList({
    items: actionStatusSchema.array().parse(data?.receipts ?? []),
    keyOf: (row) => row.id,
    search: (row) => ({ text: [row.key, row.state, row.id] }),
    select: "single",
    onPick: (row) => ctx.page.query({ actionId: row.id }),
  });
  const receipt = actionReceiptSchema.array().parse(data?.receipt??[]).find((row) => row.id === page.actionId),
    Output = receipt ? outputRenderers[receipt.key] : undefined;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-(--gutter) min-[1100px]:grid-cols-2">
      <Operation ctx={ctx} />
      <div className="flex min-h-0 flex-col gap-(--gutter)">
        <ListView
          list={list}
          aria-label="Operation receipts"
          empty={{
            message: !ctx.value.current ? ctx.value.reason : "No receipts",
            exit: "Run a semantic command to create a receipt",
          }}
          row={(row) => ({ label: row.key, meta: row.state, sub: row.startedAt, title: row.id })}
        />
        {failure && <p role="alert">{failure}</p>}
        {receipt ? (
          <>
            <p>
              {receipt.key} / {receipt.state}
            </p>
            {Output && "result" in receipt ? (
              <Output data={receipt.result} opKey={receipt.key} request={receipt.input} />
            ) : null}
            <Code code={stringify(receipt)} lang="json" />
            {(["action.read", "action.recover", "action.resume", "action.cancel"] as const).map(
              (key) => (
                <Button kind="quiet"
                  key={key}
                  label={key}
                  onClick={() =>
                    void ctx
                      .write("control")
                      .run({ key, id: receipt.id })
                      .then(() => ctx.refresh())
                      .catch((error) => setFailure(String(error)))
                  }
                >
                  {key}
                </Button>
              ),
            )}
          </>
        ) : (
          <p>Choose an action receipt</p>
        )}
      </div>
    </div>
  );
}
