import { type ComponentType, useCallback, useEffect, useState } from "react";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance } from "#/components/lang/section";
import { Verb } from "#/components/lang/verb";
import { callHostRpc } from "#/host/client";
import type { HostSessionScope, OpCallArgs, OpKey } from "@pe/host-contracts/operation-types";

/**
 * Synthetic ops: composed views that fan out several real host ops and render
 * one glance-level surface. They are prototypes of contracts that don't exist
 * yet — each one is an argument that some first-class op should return this
 * shape directly. Purely web-side; the wire stays { key, request? } per call.
 */

export type SyntheticDep = {
  /** Real host op key to call. */
  key: OpKey;
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
  call: (key: OpKey, request?: unknown) => Promise<unknown>;
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
    (key: OpKey, request?: unknown) =>
      callHostRpc(
        key,
        ...([request, { bridgeSessionId }] as OpCallArgs<typeof key, HostSessionScope>),
      ),
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
      {running && !results && (
        <OutcomeLine kind="busy" label={`gathering ${op.deps.length} ops…`} />
      )}
      {/* a failed dep is an ERROR outcome (caution — a busy bridge is not the model
          disagreeing), one line per dep, unenclosed (border budget: plain content). */}
      {results &&
        failedRequired.map((status) => (
          <OutcomeLine
            key={status.alias}
            kind="error"
            label={`${status.key} failed`}
            says={status.error}
          />
        ))}
      {results && failedRequired.length === 0 && (
        <View results={results} observedAtMs={observedAtMs} call={call} />
      )}
      {results && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Verb
            label="refresh"
            onClick={() => void runAll()}
            busy={running}
            reason="re-run every dep of this glance against the live host"
          />
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
