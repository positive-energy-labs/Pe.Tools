/**
 * The Ops body. The URL is the page: `?op` names the operation, `?target` the session and
 * document (the shell's one target grammar), `?actionId` the journaled receipt to show. Form
 * values and a read's value are render state and die with the tab.
 */
import { useEffect, useMemo, useState } from "react";

import { ActionReceiptView } from "#/actions/receipt";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Pane } from "#/components/lang/pane";
import { Press } from "#/components/lang/press";
import { Provenance } from "#/components/lang/section";
import { Surface } from "#/components/lang/surface";
import { previousOf, useFleet, useReading } from "#/readings";
import { RouteShell, useRoute } from "#/route";
import { Picker } from "#/route/picker";
import { useChooseTarget } from "#/route/shell";
import { Situation, SituationCell, useDocumentLadder } from "#/route/situation";
import { OpForm, requestOf, seedValues, type FormValues } from "#/ops/form";
import { isMutation, opsManifest, type HostOperationCatalogEntry } from "#/ops/manifest";
import { outputRenderers } from "#/ops/renderers";
import { runOp } from "#/ops/run";
import { Code, stringify } from "#/components/lang/code";

type Catalog = { operations?: HostOperationCatalogEntry[]; bridgeCatalogError?: string };
type Value = { op: string; request: unknown; value: unknown; elapsedMs: number };

export function OpsRoute({
  op,
  actionId,
  set,
}: {
  op: string;
  actionId: string | null;
  set: (patch: { op?: string; actionId?: string }) => void;
}) {
  const [chosen] = useChooseTarget();
  const [values, setValues] = useState<FormValues>({});
  const [value, setValue] = useState<Value | null>(null);

  // The catalogue is session-scoped: bridge ops list only once the sentence names a session.
  // First resolve a plain session-needing manifest for the ladder, then narrow by what it found.
  const fleet = useFleet();
  const ladderHandle = useRoute(
    useMemo(() => opsManifest(), []),
    { target: chosen },
  );
  const resolved =
    ladderHandle.resolution.kind === "resolved" ? ladderHandle.resolution.target : null;
  const sessionId =
    resolved?.kind === "session"
      ? resolved.session
      : resolved?.kind === "document"
        ? resolved.ref.session
        : undefined;
  const catalog = useReading<Catalog>({
    kind: "ops-catalog",
    ...(sessionId ? { session: sessionId } : {}),
  });
  const observed = previousOf(catalog);
  const operations = useMemo(() => observed?.operations ?? [], [observed]);
  const selected = operations.find((entry) => entry.key === op);
  const custody = fleet.sessions.find((row) => row.sessionId === sessionId)?.custody;

  useEffect(() => {
    setValues(
      seedValues(
        selected?.requestSchemaJson,
        selected?.requestExamples?.[0]?.json ?? selected?.safeDefaultRequestJson ?? undefined,
      ),
    );
    setValue(null);
  }, [selected?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const manifest = useMemo(
    () =>
      opsManifest({
        ...(selected ? { selected } : {}),
        ...(custody ? { custody } : {}),
        run: async (ctx) => {
          if (!selected) return;
          const request = requestOf(values);
          const outcome = await runOp({
            op: selected,
            request,
            target: ctx.target,
            call: ctx.call,
            priorActionId: actionId,
          });
          if (outcome.kind === "value") setValue({ op: selected.key, request, ...outcome });
          else {
            set({ actionId: outcome.id });
            if (outcome.state !== "succeeded") throw Error(`${outcome.id}: ${outcome.state}`);
          }
        },
      }),
    [selected, custody, values, actionId, set],
  );
  const handle = useRoute(manifest, { target: chosen });
  const ladder = useDocumentLadder(handle);

  const opLevel = {
    key: "op",
    label: selected ? (selected.displayName ?? selected.key) : null,
    placeholder: "choose an operation",
    options: operations.map((entry) => ({
      id: entry.key,
      label: entry.displayName ?? entry.key,
      sub: `${entry.intent ?? "unknown"} · ${entry.needs}`,
    })),
    note: catalog.state === "failed" ? catalog.message : observed?.bridgeCatalogError,
    picked: (id: string) => id === op,
    pick: (id: string) => set({ op: id, actionId: undefined }),
  };
  const Output = value ? outputRenderers[value.op] : undefined;

  return (
    <Surface
      head={
        <RouteShell
          manifest={manifest}
          handle={handle}
          situation={
            <Situation
              handle={handle}
              target={{ session: ladder.sessionWord, document: ladder.docWord }}
              sentence={
                <>
                  runs{" "}
                  <SituationCell io="r" empty={!selected}>
                    <Picker levels={[opLevel]} />
                  </SituationCell>{" "}
                  on{" "}
                  <SituationCell
                    io={selected && isMutation(selected) ? "w" : "r"}
                    empty={!ladder.docWord}
                  >
                    <Picker levels={ladder.levels} />
                  </SituationCell>
                  .
                </>
              }
            />
          }
        />
      }
    >
      <Pane kind="content" title="operation">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {actionId ? <ActionReceiptView id={actionId} /> : null}
          {selected ? (
            <section className="flex flex-col gap-4">
              <header>
                <div className="flex flex-wrap items-center gap-2">
                  <h1>{selected.displayName ?? selected.key}</h1>
                  <FactChip
                    tone={isMutation(selected) ? "caution" : "meta"}
                    title={isMutation(selected) ? "changes external state" : "read-only"}
                  >
                    {selected.intent ?? "unknown intent"}
                  </FactChip>
                  <FactChip tone="meta" title="host-declared cost tier">
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
                      <Press
                        key={example.name}
                        size="caption"
                        tone="neutral"
                        title={example.description}
                        onClick={() =>
                          setValues(seedValues(selected.requestSchemaJson, example.json))
                        }
                      >
                        {example.name}
                      </Press>
                    ))}
                  </span>
                </div>
                <OpForm
                  schemaJson={selected.requestSchemaJson}
                  values={values}
                  onChange={setValues}
                  target={
                    handle.resolution.kind === "resolved"
                      ? handle.resolution.target
                      : { kind: "host" }
                  }
                />
              </section>
              {value ? (
                <section className="flex flex-col gap-2">
                  <h2>
                    Result <span className="t-small face-mono text-ink-2">{value.elapsedMs}ms</span>
                  </h2>
                  {Output ? (
                    <Output data={value.value} opKey={value.op} request={value.request} />
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
          <Provenance>
            catalog = host.ops.catalog · mutations use the host action journal
          </Provenance>
        </div>
      </Pane>
    </Surface>
  );
}
