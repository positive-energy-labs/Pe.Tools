import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column, Verdict } from "#/components/master-table/model";
import { useFleet, type WorldFacts } from "#/host/fleet";
import { HOST_QUERY_KEY } from "#/host/queries";
import { useWorldLog } from "#/host/use-target";
import { timeAgo } from "#/lib/utils";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import type { Product } from "#/targeting/model";
import { worldTrunk, type WorldLifecycleReceipt, type WorldStart } from "#/targeting/trunks";

const YEARS = ["24", "25", "26"];
const STAGES = ["declare", "lifecycle"] as const;

export const Route = createFileRoute("/instances")({
  validateSearch: (search: Record<string, unknown>) => ({
    target: typeof search.target === "string" ? search.target.trim() : "",
    stage: STAGES.find((stage) => stage === search.stage) ?? "declare",
  }),
  component: InstancesPage,
});

type WorldVerb = (typeof worldTrunk.verbs)[keyof typeof worldTrunk.verbs];

/** The page-memory ledger boundary: an entry cannot exist before the SDK envelope does. */
export async function recordSettledLifecycle(
  verb: WorldVerb,
  world: WorldFacts | undefined,
  start: WorldStart | undefined,
  record: (receipt: WorldLifecycleReceipt) => void,
) {
  const receipt = await verb.run(world, start);
  record(receipt);
  return receipt;
}

function parseUtc(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

function yearLabel(year: string | undefined): string | undefined {
  if (!year) return undefined;
  return year.length === 2 ? `20${year}` : year;
}

function worldSub(world: WorldFacts): string {
  return [world.lane, yearLabel(world.year), world.pid ? `pid ${world.pid}` : undefined]
    .filter(Boolean)
    .join(" · ");
}

function phaseVerdict(world: WorldFacts): Verdict {
  const state = world.row?.state;
  if (world.phase === "ready")
    return {
      word: state ?? "ready",
      tone: "done",
      note: world.session
        ? "The bridge holds an open connection to this world."
        : (world.row?.detail ?? "pe-revit verified this process identity."),
    };
  if (world.phase === "booting")
    return {
      word: state ?? "booting",
      tone: "ink",
      note: world.row?.detail ?? "The registry says this process is in its boot window.",
    };
  if (world.phase === "unresponsive")
    return {
      word: state ?? "unresponsive",
      tone: "caution",
      note: world.row?.detail ?? "The process exists but stopped answering.",
    };
  return {
    word: state ?? "gone",
    tone: "mute",
    dim: true,
    note: world.row?.detail ?? "pe-revit says this world is gone.",
  };
}

function custodyVerdict(world: WorldFacts): Verdict {
  return world.custody === "controlled"
    ? {
        word: "controlled",
        tone: "done",
        note: "pe-revit holds this session's receipt and owns its lifecycle.",
      }
    : {
        word: "observed",
        tone: "mute",
        note: "pe-revit holds no receipt: status and document reads only.",
      };
}

function StartFields({
  year,
  lane,
  doc,
  disabled,
  setYear,
  setLane,
  setDoc,
}: {
  year: string;
  lane: WorldStart["lane"];
  doc: string;
  disabled: boolean;
  setYear: (year: string) => void;
  setLane: (lane: WorldStart["lane"]) => void;
  setDoc: (doc: string) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <select
        aria-label="Revit year"
        value={year}
        onChange={(event) => setYear(event.target.value)}
        disabled={disabled}
        className="face-mono t-caption rounded-[var(--radius)] border border-[var(--r-line-2)] bg-transparent px-1 py-0.5"
      >
        {YEARS.map((value) => (
          <option key={value} value={value}>
            20{value}
          </option>
        ))}
      </select>
      <select
        aria-label="payload lane"
        value={lane}
        onChange={(event) => setLane(event.target.value as WorldStart["lane"])}
        disabled={disabled}
        className="face-mono t-caption rounded-[var(--radius)] border border-[var(--r-line-2)] bg-transparent px-1 py-0.5"
      >
        <option value="installed">installed</option>
        <option value="dev">dev</option>
      </select>
      <input
        aria-label="document"
        value={doc}
        onChange={(event) => setDoc(event.target.value)}
        disabled={disabled}
        placeholder="document (optional)"
        className="face-mono t-caption w-44 rounded-[var(--radius)] border border-[var(--r-line-2)] bg-transparent px-1 py-0.5"
      />
    </span>
  );
}

export function InstancesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/instances" });
  const queryClient = useQueryClient();
  const { worlds, sessions, isLoading, error, stale, at, basis } = useFleet(true);
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

  const selectedWorld = worldTrunk.resolve(worlds, sessions, search.target);
  const runLifecycle = async (key: keyof typeof worldTrunk.verbs) => {
    const verb = worldTrunk.verbs[key];
    setBusy(key);
    setOutcome(null);
    try {
      const receipt = await recordSettledLifecycle(
        verb,
        selectedWorld,
        key === "start"
          ? {
              lane: startLane,
              year: startYear,
              ...(startDoc.trim() ? { doc: startDoc.trim() } : {}),
            }
          : undefined,
        (settled) =>
          setLocalLog((log) => [
            ...log.slice(-99),
            { atMs: Date.now(), actor: "you", label: worldTrunk.describe(settled) },
          ]),
      );
      setOutcome({
        kind: receipt.ok ? "receipt" : "advisory",
        text: receipt.diagnostics[0] ?? worldTrunk.describe(receipt),
        says: receipt.nextSteps.length ? receipt.nextSteps.join(" · ") : undefined,
      });
      return worldTrunk.describe(receipt);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `${key} failed`;
      setOutcome({ kind: "error", text: message });
      return message;
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
    }
  };

  const product: Product = {
    key: "instances",
    name: "instances",
    links: [worldTrunk.link],
    manages: ["world"],
    stages: [
      {
        key: "declare",
        label: "declare",
        verbs: [
          {
            ...worldTrunk.verbs.start,
            run: () => runLifecycle("start"),
            refuse: () => worldTrunk.verbs.start.refuse(selectedWorld),
          },
        ],
      },
      {
        key: "lifecycle",
        label: "lifecycle",
        verbs: (["converge", "restart", "stop"] as const).map((key) => ({
          ...worldTrunk.verbs[key],
          run: () => runLifecycle(key),
          refuse: () => worldTrunk.verbs[key].refuse(selectedWorld),
        })),
      },
    ],
    panes: [
      { key: "fleet", label: "fleet", draws: ["world"] },
      { key: "ledger", label: "ledger", draws: ["world"] },
    ],
  };
  const feeds = {
    world: worldTrunk.feed({ worlds, sessions, isLoading, stale, error, at, basis }),
  };
  const state: BindingState = {
    bound: { world: search.target || null },
    multi: {},
    stage: search.stage,
  };
  const setState = (patch: Partial<BindingState>) =>
    void navigate({
      search: (previous) => ({
        ...previous,
        target: patch.bound?.world ?? previous.target,
        stage: (patch.stage as (typeof STAGES)[number] | undefined) ?? previous.stage,
      }),
    });
  const bindings = useBindings(
    product,
    feeds,
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
        cell: (world) => (
          <span className="face-mono t-value block truncate px-1.5 text-[var(--r-ink)]">
            {worldTrunk.label(world)}
          </span>
        ),
      },
      { key: "custody", label: "custody", width: "w-28", verdict: custodyVerdict },
      { key: "phase", label: "phase", width: "w-32", verdict: phaseVerdict },
      {
        key: "detail",
        label: "lane · year · pid",
        cell: (world) => (
          <span className="face-mono t-caption block truncate px-1.5 text-[var(--r-ink-2)]">
            {worldSub(world)}
          </span>
        ),
      },
      {
        key: "legs",
        label: "legs",
        cell: (world) => (
          <span className="face-mono t-caption block truncate px-1.5 text-[var(--r-ink-2)]">
            {world.row?.legs?.map((leg) => `${leg.name} ${leg.state}`).join(" · ") || "no legs"}
          </span>
        ),
      },
      {
        key: "docs",
        label: "documents",
        cell: (world) => (
          <span className="face-mono t-caption block truncate px-1.5 text-[var(--r-ink-2)]">
            {world.activeDocumentTitle ?? (world.session ? "no open document" : "nothing observed")}
            {world.openDocumentCount > 1 ? ` +${world.openDocumentCount - 1}` : ""}
          </span>
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
          <span className="face-mono t-caption block px-1.5 text-right text-[var(--r-ink-2)]">
            {timeAgo(
              world.session ? world.session.observedAtUnixMs : parseUtc(world.row?.observedAtUtc),
            )}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="min-h-screen bg-[var(--r-page)]" data-testid="instances-workspace">
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
            search.stage === "declare" ? (
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
        <div className="flex flex-1 flex-col border-r border-[var(--r-line)] pr-5">
          <MasterTable
            rows={worlds}
            columns={columns}
            rowKey={(world) => world.id}
            scopeLabel="fleet"
            activeKey={selectedWorld?.id}
            onRowClick={(world) =>
              setState({ bound: { world: worldTrunk.option(world, sessions).id } })
            }
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
          {error ? (
            <OutcomeLine
              className="mt-2"
              kind="error"
              label={`fleet unreadable: ${error.message}`}
            />
          ) : null}
        </div>
        {ledgerOpen ? (
          <div className="flex w-72 flex-col pl-5">
            <div className="flex items-baseline justify-between pb-2">
              <span className="flex items-center gap-1.5">
                <span className="t-caption t-upper text-[var(--r-ink-2)]">ledger</span>
                <HelpTip>Settled SDK envelopes merged with bridge-observed world events.</HelpTip>
              </span>
              <button
                type="button"
                onClick={() => setLedgerOpen(false)}
                className="t-caption rounded-[var(--radius)] border border-[var(--r-line-2)] px-1"
              >
                ›
              </button>
            </div>
            <div ref={logRef} className="max-h-[72vh] min-h-0 flex-1 overflow-y-auto">
              {ledger.length === 0 ? (
                <EmptyState story="scope" exit="run a lifecycle verb or wait for a world event">
                  nothing observed yet
                </EmptyState>
              ) : null}
              {ledger.map((entry, index) => (
                <div key={index} className="border-t border-[var(--r-line)] py-1.5">
                  <span className="face-mono t-caption text-[var(--r-ink-2)]">{entry.actor}</span>
                  <div className="t-label text-[var(--r-ink)]">{entry.label}</div>
                  <span className="face-mono t-caption text-[var(--r-ink-2)]">
                    {timeAgo(entry.atMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLedgerOpen(true)}
            className="ml-2 flex w-6 flex-col items-center gap-2 self-stretch rounded-[var(--radius)] border border-[var(--r-line-2)] bg-transparent py-2"
          >
            <span className="t-caption t-upper text-[var(--r-ink-2)] [writing-mode:vertical-rl]">
              ledger · {ledger.length}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
