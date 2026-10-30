import type { ReadingState } from "#/shell/readings";
import { useEffect } from "react";
import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { Code, stringify } from "@pe/kit/lang/code";
import { Ladder } from "#/route/ladder";
import { NativeObservationScope } from "#/revit/observation";
import type { DocumentRef } from "@pe/agent-contracts";
import type { MountBody } from "#/shell/mount";
import { OpForm, seedValues, type FormValues } from "./form";
import { isMutation } from "./manifest";
import { outputRenderers } from "./renderers";
import type { OpsPage } from "./graph";
import type { OpsCatalog } from "./sources";
type Value = {
  op: string;
  request: unknown;
  value: unknown;
  elapsedMs: number;
  document: DocumentRef | null;
};
export function OpsBody({ owner, page }: MountBody<OpsPage, unknown>) {
  const catalog = owner.readings.get("catalog") as ReadingState<OpsCatalog>;
  const observed = catalog.value ?? catalog.previous;
  const operations = observed?.operations ?? [];
  const selected = operations.find((entry) => entry.key === page.op);
  const values = page.values;
  const setValues = (values: FormValues) => owner.view.setPage({ values });
  const value = page.result as Value | null;
  const Output = value ? outputRenderers[value.op] : undefined;
  useEffect(() => {
    if (selected)
      owner.view.setPage({
        values: seedValues(
          selected.requestSchemaJson,
          selected.requestExamples?.[0]?.json ?? selected.safeDefaultRequestJson ?? undefined,
        ),
        result: null,
      });
  }, [owner, selected?.key]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <Ladder
        levels={[
          {
            key: "op",
            label: selected?.displayName ?? selected?.key ?? null,
            placeholder: "choose an operation",
            options: operations.map((entry) => ({
              id: entry.key,
              label: entry.displayName ?? entry.key,
              sub: `${entry.intent ?? "unknown"} / ${entry.needs}`,
            })),
            note: catalog.error ?? observed?.bridgeCatalogError,
            picked: (id) => id === page.op,
            pick: (op) => owner.view.setPage({ op }),
          },
        ]}
      />
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
                  <Button
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
              target={owner.snapshot().target}
            />
          </section>
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
          exit="choose an operation in the sentence; a session lists its Revit ops"
        >
          no operation selected
        </EmptyState>
      )}
    </div>
  );
}
