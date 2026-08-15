import { type ComponentType, useCallback, useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { callHostDynamic } from "#/host/client";
import { MonoNote, Provenance } from "#/ops/primitives";

/**
 * Synthetic ops: composed views that fan out several real host ops and render
 * one glance-level surface. They are prototypes of contracts that don't exist
 * yet — each one is an argument that some first-class op should return this
 * shape directly. Purely web-side; the wire stays { key, request? } per call.
 */

export type SyntheticDep = {
  /** Real host op key to call. */
  key: string;
  request?: unknown;
  /** Alias in the results map (defaults to key). Lets one op appear twice. */
  as?: string;
  /** Optional deps render the view even when they fail; required ones block it. */
  optional?: boolean;
};

export type SyntheticViewProps = {
  /** Dep results keyed by alias/key; absent when that dep failed. */
  results: Record<string, unknown>;
  /** Wall-clock of the fan-out completing — every synthetic claim is "as of" this. */
  observedAtMs: number;
  /** Staged follow-up fetches (same session scope as the fan-out). */
  call: (key: string, request?: unknown) => Promise<unknown>;
};

export type SyntheticOp = {
  /** Namespaced away from real ops: "glance.*". */
  key: string;
  displayName: string;
  /** One line: what question this answers at a glance. */
  blurb: string;
  /** The contract this prototypes — feeds the op-contract feedback loop. */
  contractNote?: string;
  deps: SyntheticDep[];
  View: ComponentType<SyntheticViewProps>;
};

type DepStatus = { alias: string; key: string; ok: boolean; error?: string; elapsedMs: number };

export function SyntheticRunner({
  op,
  bridgeSessionId,
}: {
  op: SyntheticOp;
  bridgeSessionId?: string;
}) {
  const [results, setResults] = useState<Record<string, unknown>>();
  const [statuses, setStatuses] = useState<DepStatus[]>([]);
  const [observedAtMs, setObservedAtMs] = useState(0);
  const [running, setRunning] = useState(false);

  const call = useCallback(
    (key: string, request?: unknown) => callHostDynamic(key, request, { bridgeSessionId }),
    [bridgeSessionId],
  );

  const runAll = useCallback(async () => {
    setRunning(true);
    const settled = await Promise.all(
      op.deps.map(async (dep) => {
        const started = performance.now();
        try {
          const data = await call(dep.key, dep.request);
          return { dep, data, elapsedMs: Math.round(performance.now() - started) };
        } catch (error) {
          return {
            dep,
            error: error instanceof Error ? error.message : String(error),
            elapsedMs: Math.round(performance.now() - started),
          };
        }
      }),
    );
    const next: Record<string, unknown> = {};
    for (const item of settled) {
      if (!("error" in item)) next[item.dep.as ?? item.dep.key] = item.data;
    }
    setStatuses(
      settled.map((item) => ({
        alias: item.dep.as ?? item.dep.key,
        key: item.dep.key,
        ok: !("error" in item),
        error: "error" in item ? item.error : undefined,
        elapsedMs: item.elapsedMs,
      })),
    );
    setResults(next);
    setObservedAtMs(Date.now());
    setRunning(false);
  }, [op, call]);

  useEffect(() => {
    void runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.key, bridgeSessionId]);

  const failedRequired = statuses.filter(
    (status) =>
      !status.ok && !op.deps.find((dep) => (dep.as ?? dep.key) === status.alias)?.optional,
  );
  const View = op.View;

  return (
    <div className="flex flex-col gap-3">
      {running && !results && <MonoNote>gathering {op.deps.length} ops…</MonoNote>}
      {results && failedRequired.length > 0 && (
        <div
          className="rounded-[2px] p-3 text-xs"
          style={{ border: "0.5px solid var(--line-2)", color: "var(--cat-clay)" }}
        >
          {failedRequired.map((status) => (
            <div key={status.alias} className="tele">
              {status.key}: {status.error}
            </div>
          ))}
        </div>
      )}
      {results && failedRequired.length === 0 && (
        <View results={results} observedAtMs={observedAtMs} call={call} />
      )}
      {results && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="ghost" size="xs" onClick={() => void runAll()} disabled={running}>
            {running ? "refreshing…" : "refresh"}
          </Button>
          <Provenance>
            composed from{" "}
            {statuses
              .map((status) => `${status.key} ${status.ok ? `${status.elapsedMs}ms` : "✕"}`)
              .join(" · ")}{" "}
            · obs {observedAtMs ? new Date(observedAtMs).toLocaleTimeString() : "—"}
          </Provenance>
        </div>
      )}
    </div>
  );
}
