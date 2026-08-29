import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { current, instancesRouteState, type Address } from "@pe/agent-contracts";
import { EmptyState } from "#/components/lang/empty";
import { StateCell } from "#/components/lang/cell";
import { Tag } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { useFleet, type WorldFacts } from "#/host/fleet";
import { HOST_QUERY_KEY } from "#/host/queries";
import { useWorldLog } from "#/host/use-target";
import { timeAgo } from "#/lib/utils";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingPatch, type BindingState } from "#/targeting/kit";
import { product as defineProduct } from "#/targeting/model";
import { worldTrunk, type WorldStart } from "#/targeting/world";
import { useRouteState } from "#/workbench/route-state";
import { Press } from "#/components/lang/press";
import { Provenance } from "#/components/lang/section";
import { StartFields, custodyVerdict, parseUtc, phaseVerdict, worldSub } from "#/instances/route";

export function AddressedInstancesPage({ documentAddress }: { documentAddress: Address }) {
  const route = useRouteState(instancesRouteState, { documentAddress });
  const target = current(route.slice?.bindings.world, documentAddress)?.id ?? "";
  const [stage, setStage] = useState("declare");
  const queryClient = useQueryClient();
  const { worlds, sessions, isLoading, error, stale, at, basis } = useFleet({ all: true });
  const worldLog = useWorldLog(sessions);
  const [localLog, setLocalLog] = useState<{ atMs: number; actor: "you"; label: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    kind: OutcomeKind;
    text: string;
    says?: string;
  } | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [startYear, setStartYear] = useState("25");
  const [startDoc, setStartDoc] = useState("");
  const [startLane, setStartLane] = useState<WorldStart["lane"]>("installed");
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [pickerLevel, setPickerLevel] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const liveWorlds = worlds.filter((world) => world.phase !== "gone");
  const selectedWorld = worldTrunk.resolve(liveWorlds, sessions, target);
  const feeds = {
    world: worldTrunk.feed({ worlds: liveWorlds, sessions, isLoading, stale, error, at, basis }),
  };
  const lifecycleVerbs = worldTrunk.verbs<"world">({
    start: () => ({
      lane: startLane,
      year: startYear,
      ...(startDoc.trim() ? { doc: startDoc.trim() } : {}),
    }),
    started: (action) => {
      setBusy(action);
      setOutcome(null);
    },
    settled: (receipt) => {
      setLocalLog((log) => [
        ...log.slice(-99),
        { atMs: Date.now(), actor: "you", label: worldTrunk.describe(receipt) },
      ]);
      setOutcome({
        kind: receipt.ok ? "receipt" : "advisory",
        text: receipt.diagnostics[0] ?? worldTrunk.describe(receipt),
        says: receipt.nextSteps.length ? receipt.nextSteps.join(" · ") : undefined,
      });
    },
    failed: (action, caught) =>
      setOutcome({
        kind: "error",
        text: caught instanceof Error ? caught.message : `${action} failed`,
      }),
    finished: () => {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
    },
  });
  const product = defineProduct("instances", "instances", { world: worldTrunk.link })({
    feeds,
    stages: [
      {
        key: "declare",
        label: "declare",
        verbs: [
          {
            ...lifecycleVerbs.start,
          },
        ],
      },
      {
        key: "lifecycle",
        label: "lifecycle",
        verbs: (["converge", "restart", "stop"] as const).map((key) => ({
          ...lifecycleVerbs[key],
          label: key === "stop" && selectedWorld?.phase === "unresponsive" ? "force stop" : key,
        })),
      },
    ],
    panes: [
      { key: "fleet", label: "fleet", draws: ["world"] },
      { key: "ledger", label: "ledger", draws: ["world"] },
    ],
  });
  const state: BindingState<"world"> = {
    bound: { world: target || null },
    multi: {},
    stage,
  };
  const setState = (patch: BindingPatch<"world">) => {
    const nextTarget = patch.bound?.world;
    if (patch.stage) setStage(patch.stage);
    if (nextTarget !== undefined)
      void route.apply([
        {
          path: ["bindings", "world"],
          value: nextTarget
            ? { id: nextTarget, label: nextTarget, at: documentAddress }
            : undefined,
        },
      ]);
  };
  const bindings = useBindings(
    product,
    state,
    setState,
    pickerOpen,
    setPickerOpen,
    pickerLevel,
    setPickerLevel,
    pickerQuery,
    setPickerQuery,
  );
  const runner = useRunner(product, bindings, busy);
  const ledger = [
    ...worldLog.map((event) => ({
      atMs: event.atMs,
      actor: "bridge" as const,
      label: event.label,
    })),
    ...localLog,
  ].sort((left, right) => left.atMs - right.atMs);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [ledger.length, ledgerOpen]);

  const columns = useMemo<Column<WorldFacts>[]>(
    () => [
      {
        key: "world",
        label: "world",
        search: (world) => worldTrunk.label(world).toLowerCase(),
        sort: (world) => worldTrunk.label(world),
        cell: (world) => <StateCell scale="row" value={worldTrunk.label(world)} />,
      },
      { key: "custody", label: "custody", width: "w-28", verdict: custodyVerdict },
      { key: "phase", label: "phase", width: "w-32", verdict: phaseVerdict },
      {
        key: "detail",
        label: "lane · year · pid",
        cell: (world) => <StateCell scale="row" value={worldSub(world)} />,
      },
      {
        key: "legs",
        label: "legs",
        cell: (world) => (
          <StateCell
            scale="row"
            value={
              world.row?.legs?.map((leg) => `${leg.name} ${leg.state}`).join(" · ") || "no legs"
            }
          />
        ),
      },
      {
        key: "docs",
        label: "documents",
        cell: (world) => (
          <StateCell
            scale="row"
            value={`${world.activeDocumentTitle ?? (world.session ? "no open document" : "nothing observed")}${world.openDocumentCount > 1 ? ` +${world.openDocumentCount - 1}` : ""}`}
          />
        ),
      },
      {
        key: "seen",
        label: "seen",
        right: true,
        width: "w-24",
        sort: (world) =>
          (world.session ? world.session.observedAtUnixMs : parseUtc(world.row?.observedAtUtc)) ??
          0,
        cell: (world) => (
          <StateCell
            scale="row"
            value={timeAgo(
              world.session ? world.session.observedAtUnixMs : parseUtc(world.row?.observedAtUtc),
            )}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div className="min-h-screen" data-testid="instances-workspace">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <TargetingHead
          product={product}
          b={bindings}
          runner={runner}
          receipt={
            outcome ? (
              <OutcomeLine kind={outcome.kind} label={outcome.text} says={outcome.says} />
            ) : undefined
          }
          aside={
            stage === "declare" ? (
              <StartFields
                year={startYear}
                lane={startLane}
                doc={startDoc}
                disabled={busy !== null}
                setYear={setStartYear}
                setLane={setStartLane}
                setDoc={setStartDoc}
              />
            ) : undefined
          }
        />
      </div>
      <div className="mx-auto flex min-h-[75vh] max-w-6xl gap-0 px-6 py-5">
        <div className="flex flex-1 flex-col pr-5">
          <MasterTable
            rows={worlds}
            columns={columns}
            rowKey={(world) => world.id}
            scopeLabel="fleet"
            activeKey={selectedWorld?.id}
            onRowClick={(world) => {
              if (world.phase !== "gone")
                setState({ bound: { world: worldTrunk.option(world, sessions).id } });
            }}
            empty={
              isLoading ? (
                <OutcomeLine kind="busy" label="reading the fleet" />
              ) : (
                <EmptyState story="scope" exit="use declare · start above">
                  no worlds known
                </EmptyState>
              )
            }
          />
          {error ? <OutcomeLine kind="error" label={`fleet unreadable: ${error.message}`} /> : null}
        </div>
        {ledgerOpen ? (
          <div className="flex w-72 flex-col pl-5">
            <div className="flex items-baseline justify-between pb-2">
              <span className="flex items-center gap-1.5">
                <Tag>ledger</Tag>
                <HelpTip>Settled SDK envelopes merged with bridge-observed world events.</HelpTip>
              </span>
              <Press
                type="button"
                onClick={() => setLedgerOpen(false)}
                tone="neutral"
                size="caption"
              >
                ›
              </Press>
            </div>
            <div ref={logRef} className="max-h-[72vh] min-h-0 flex-1 overflow-y-auto">
              {ledger.length === 0 ? (
                <EmptyState story="scope" exit="run a lifecycle verb or wait for a world event">
                  nothing observed yet
                </EmptyState>
              ) : null}
              {ledger.map((entry, index) => (
                <div key={index} className="py-1.5">
                  <Tag>{entry.actor}</Tag>
                  <StateCell value={entry.label} />
                  <Provenance>{timeAgo(entry.atMs)}</Provenance>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="ml-2 flex w-6 flex-col items-center gap-2 self-stretch py-2">
            <Press type="button" onClick={() => setLedgerOpen(true)} tone="neutral">
              <span className="[writing-mode:vertical-rl]">
                <Tag>ledger · {ledger.length}</Tag>
              </span>
            </Press>
          </div>
        )}
      </div>
    </div>
  );
}
