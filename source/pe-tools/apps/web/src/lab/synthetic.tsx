import { type ComponentType, useCallback, useEffect, useState } from "react";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance } from "#/components/lang/section";
import { ActionButton } from "#/components/lang/action-button";
import { callHostRpc } from "#/host/client";
import type { HostSessionScope, OpCallArgs, OpKey } from "@pe/host-contracts/operation-types";

type SyntheticDep = {
  key: OpKey;
  request?: unknown;
  as?: string;
  optional?: boolean;
};

export type SyntheticViewProps = {
  results: Record<string, unknown>;
  observedAtMs: number;
  call: (key: OpKey, request?: unknown) => Promise<unknown>;
};

export type SyntheticOp = {
  key: string;
  displayName: string;
  blurb: string;
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
          <ActionButton
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
