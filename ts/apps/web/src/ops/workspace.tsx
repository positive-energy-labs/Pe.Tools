import { useEffect, useState } from "react";
import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { Code, stringify } from "@pe/kit/lang/code";
import { NativeObservationScope } from "#/revit/observation";
import type { DocumentRef } from "@pe/agent-contracts";
import { nameOf } from "#/route/typed-route";
import type { OpsContext } from "./route";
import { requestOf } from "./form";
import { OpForm, seedValues, type FormValues } from "./form";
import { isMutation } from "./manifest";
import { outputRenderers } from "./renderers";

type Value = {
  op: string;
  request: unknown;
  value: unknown;
  elapsedMs: number;
  document: DocumentRef | null;
};
export function Operation({ ctx }: { ctx: OpsContext }) {
  const page = ctx.page.read(),
    observed = ctx.value.value?.catalog;
  const [values, setValues] = useState<FormValues>({}),
    [value, setValue] = useState<Value | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const operations = observed?.operations ?? [];
  const selected = operations.find((entry) => entry.key === nameOf(page.op));
  const note = !ctx.value.current ? ctx.value.reason : observed?.bridgeCatalogError;

  const Output = value ? outputRenderers[value.op] : undefined;
  useEffect(() => {
    if (selected)
      setValues(
        seedValues(
          selected.requestSchemaJson,
          selected.requestExamples?.[0]?.json ?? selected.safeDefaultRequestJson ?? undefined,
        ),
      );
    setValue(null);
  }, [selected?.key]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* The kernel draws the op chooser from the subject slot (pane head); a route draws no second one. */}
      {note ? <p role="status">{note}</p> : null}
      {selected ? (
        <section className="flex flex-col gap-4">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{selected.displayName ?? selected.key}</h1>
              <FactChip
                tone={isMutation(selected) ? "caution" : undefined}
                title={isMutation(selected) ? "changes external state" : "read-only"}
              >
                {selected.intent ?? "unknown intent"}
              </FactChip>
              <FactChip title="host-declared cost tier">
                {selected.costTier ?? "unknown cost"}
              </FactChip>
            </div>
            <p>{selected.key}</p>
            <p className="max-w-2xl">{selected.description}</p>
          </header>
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2>Request</h2>
              <span className="flex gap-1">
                {(selected.requestExamples ?? []).map((example) => (
                  <Button kind="quiet"
                    key={example.name}
                    label={example.name}
                    reason={example.description}
                    onClick={() => setValues(seedValues(selected.requestSchemaJson, example.json))}
                  >
                    {example.name}
                  </Button>
                ))}
              </span>
            </div>
            <OpForm
              schemaJson={selected.requestSchemaJson}
              values={values}
              onChange={setValues}
              target={ctx.target ?? { kind: "host" }}
            />
          </section>
          <Button
            label="Run operation read"
            refusal={
              isMutation(selected)
                ? "Use a semantic command with Plan and Apply for mutations"
                : !ctx.value.current
                  ? ctx.value.reason
                  : null
            }
            onClick={() =>
              void ctx
                .write("run")
                .run({ op: selected, request: requestOf(values) })
                .then((result) => {
                  setValue(result as Value);
                  setFailure(null);
                })
                .catch((error) => setFailure(String(error)))
            }
          >
            Run read
          </Button>
          {failure && <p role="alert">{failure}</p>}
          {value ? (
            <section className="flex flex-col gap-2">
              <h2>
                Result <span className="t-small face-mono text-ink-2">{value.elapsedMs}ms</span>
              </h2>
              {Output ? (
                <NativeObservationScope
                  value={{ scope: { document: value.document, source: "native" } }}
                >
                  <Output data={value.value} opKey={value.op} request={value.request} />
                </NativeObservationScope>
              ) : null}
              <details open={!Output}>
                <summary className="cursor-pointer">raw response</summary>
                <Code code={stringify(value.value)} lang="json" />
              </details>
            </section>
          ) : null}
        </section>
      ) : (
        <EmptyState
          story="scope"
          exit="choose an operation in the head; a session lists its Revit ops"
        >
          no operation selected
        </EmptyState>
      )}
    </div>
  );
}
