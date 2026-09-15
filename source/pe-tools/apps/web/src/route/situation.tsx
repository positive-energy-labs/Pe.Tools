/**
 * THE SITUATION — the one route head (design-system ledger, 2026-09-13). The name line carries the
 * route's name and, on its right, the CLUSTER: the chain lamp, the state gauge, help and theme,
 * always together. Under it the board splits long-ways: the sentence and the verb row on the left,
 * the page log on the right; on a narrow screen it drops below. The ledger lives behind the gauge.
 *
 * One sentence: the stage word first, then the route's slots joined by the route's own words.
 * The verb row projects into a vertical view on its toggle, where each button says why it is
 * refused (or what it does) and what it dispatches and where. Every verb's outcome grows out of
 * its button as a flag; nothing else in the head moves. Staged Work is a band under the verb row:
 * this file owns its frame (count and noun, revision, read freshness, commit, discard, conflict
 * with reload) and the route fills its body.
 *
 * The head is an ARTIFACT: a machine-operated object that carries state, so it wears the kit's
 * one enclosure — the name line is the recessed head band, the board sits on artifact ground.
 * Four kinds of information, four marks: prose (what a verb does) in secondary ink; nouns the
 * machine knows (targets, Readings, actors) as fact chips; measured values (times, counts,
 * revisions) in mono; state words in their tone. Colour is spent only where meaning changes.
 *
 * The route declares verbs once (its manifest); this file only draws them. Geometry lives here,
 * marks come from the kit: dotted = operable, dashed = empty slot, caution = the world disagrees,
 * bold = unsaved, mono = measured.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Gauge } from "lucide-react";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { StateDot } from "#/components/master-table/cells";
import { ThemeToggle } from "#/components/lang/theme-toggle";

import { inventoryOf, previousOf } from "#/readings";

import { RouteHelpButton } from "./help";
import { FlowMatrix } from "./flow";
import { RouteInspector } from "./inspector";
import type { RouteAction } from "./manifest";
import { Picker } from "./picker";
import { useChooseTarget, useHostLamp } from "./shell";
import type { ActionHandle, LogEntry, RouteHandle } from "./use-route";

/* ── marks ─────────────────────────────────────────────────────────────────── */

/** A slot in the sentence: an operable value with its io mark (`r`, `w`, `rw`) as a superscript. */
export function SituationCell({
  io,
  empty,
  children,
}: {
  io?: "r" | "w" | "rw";
  /** Dashed = the slot is declared and holds nothing yet. */
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline" data-empty={empty || undefined}>
      {io ? <sup className="mr-0.5 t-small face-mono text-ink-mute">{io}</sup> : null}
      {children}
    </span>
  );
}

const slotTrigger =
  "cursor-pointer border-b border-dotted border-current data-[empty]:border-dashed data-[empty]:text-ink-2";

/** One slot picker: the trigger is the value, the popup is what the route puts inside. */
export function SituationChoice({
  label,
  empty,
  children,
}: {
  label: ReactNode;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className={slotTrigger} data-empty={empty || undefined}>
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="artifact"
            className="max-h-96 w-80 max-w-(--available-width) overflow-auto rounded-lg p-2 t-prose text-ink ring-1 ring-line outline-none"
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ── the chain lamp ────────────────────────────────────────────────────────── */

/**
 * host › session › document, one instrument that says ONE thing at rest: the deepest link that
 * answers (the document, which is the picker), or the first link that does not. The host is named
 * only when it is the broken link — a connected host with no session is "choose a session", not
 * "host · connected › no session". The whole chain rides the title.
 */
export function ChainLamp({
  handle,
  health,
  session,
  document,
}: {
  handle: RouteHandle<any, any, any, any>;
  /** The document's complaint, when it has one ("needs initialization · 4 carriers"). */
  health?: string | null;
  /** The bound session's word (the pe-revit id when it has one); null = no session. */
  session: string | null;
  /** Diagnostic label only; the sentence owns target selection. */
  document: string | null;
}) {
  const host = useHostLamp();
  const resolution = handle.resolution;
  const hostOk = host.tone === "done";
  const sessionWord =
    session ??
    (resolution.kind === "choose" ? resolution.reason.replaceAll("-", " ") : "no session");
  const title = [
    `host · ${host.word} — ${host.says}`,
    `session · ${sessionWord}`,
    health ? `document · ${health}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const dot = (on: boolean, tone: "done" | "alarm" | "caution" | "mute" = "done") =>
    on ? (
      <StateDot tone={tone} />
    ) : (
      <span className="inline-block size-2 shrink-0 rounded-[1px] border border-ink-mute align-middle" />
    );
  if (!hostOk)
    return (
      <span className="flex items-center gap-1.5 t-small face-mono text-ink-mute" title={title}>
        {dot(host.tone === "ink", host.tone === "alarm" ? "alarm" : "mute")}
        <span data-tone={host.tone === "alarm" ? "alarm" : undefined}>host · {host.word}</span>
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 t-small face-mono text-ink-mute" title={title}>
      {dot(session !== null, health ? "caution" : "done")}
      <span
        className={health ? undefined : "text-ink-2"}
        data-tone={health ? "caution" : undefined}
      >
        {document ?? "no document selected"}
        {health ? ` · ${health}` : ""}
      </span>
    </span>
  );
}

/* ── the cluster ───────────────────────────────────────────────────────────── */

/**
 * The state gauge: one icon on the cluster that opens the route's state — what the caller hands
 * in (Chat's ledger and log) and, in dev, the route inspector (target, Work, Readings, actions).
 * Nothing when there is nothing to show.
 */
function StateGauge({
  handle,
  children,
}: {
  handle: RouteHandle<any, any, any, any>;
  children?: ReactNode;
}) {
  if (!import.meta.env.DEV && children == null) return null;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Press tone="quiet" size="icon" />}
        title="route state: what is bound, what ran, and the route's nouns"
        aria-label="Route state"
      >
        <Gauge className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="artifact"
            className="flex max-h-(--available-height) w-[44rem] max-w-(--available-width) flex-col gap-3 overflow-auto rounded-lg p-3 t-prose text-ink ring-1 ring-line outline-none"
          >
            {children}
            <FlowMatrix handle={handle} />
            <RouteInspector handle={handle} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Lamp · gauge · help · theme, always together, on the right of the name line. */
export function Cluster({
  handle,
  lamp,
  state,
}: {
  handle: RouteHandle<any, any, any, any>;
  lamp: ReactNode;
  /** What the state gauge shows above the inspector (Chat hands in its ledger and log). */
  state?: ReactNode;
}) {
  return (
    <span className="flex shrink-0 items-center gap-3">
      {lamp}
      <StateGauge handle={handle}>{state}</StateGauge>
      <RouteHelpButton name={handle.manifest.name} docs={handle.manifest.docs} />
      <ThemeToggle />
    </span>
  );
}

/* ── the document ladder ───────────────────────────────────────────────────── */

/**
 * session › document, read from the bridge inventory: titles and pe-revit ids, not GUIDs.
 * By default the ladder binds through `?target`; a route whose binding lives elsewhere (Chat's
 * thread head) hands in its own `binding` and the ladder reads and writes that instead.
 */
export function useDocumentLadder(
  handle: RouteHandle<any, any, any, any>,
  onTarget?: () => void,
  binding?: {
    bound: { session: string; openId: string } | null;
    bind: (ref: { session: string; openId: string }) => void;
  },
) {
  const [, choose] = useChooseTarget();
  const inventory = handle.readings.inventory ?? { state: "absent" };
  const observed = previousOf(inventory) as
    | { sessions?: readonly BridgeSessionListEntry[] }
    | undefined;
  const sessions = inventoryOf(observed?.sessions ?? []);
  const bound = binding
    ? binding.bound
    : handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const [pending, setPending] = useState<string | null>(null);
  const sessionId = pending ?? bound?.session ?? null;
  const session = sessions.find((item) => item.sessionId === sessionId) ?? null;
  const doc = session?.openDocuments?.find((item) => item.openId === bound?.openId) ?? null;
  const note =
    inventory.state === "failed"
      ? inventory.message
      : inventory.state === "loading" && !sessions.length
        ? "reading sessions…"
        : undefined;
  const pick = (openId: string) => {
    if (!sessionId) return;
    onTarget?.();
    setPending(null);
    const ref = { session: sessionId, openId };
    if (binding) binding.bind(ref);
    else choose(JSON.stringify({ kind: "open", ref }));
  };
  const sessionWord = session ? (session.sdkSessionId ?? session.sessionId) : null;
  return {
    sessionWord,
    docWord: doc?.title ?? null,
    levels: [
      {
        key: "session",
        label: sessionWord,
        placeholder: "choose a session",
        options: sessions.map((item) => ({
          id: item.sessionId,
          label: item.sdkSessionId ?? item.sessionId,
          sub: `${item.openDocumentCount} open${item.lane ? ` · ${item.lane}` : ""}`,
        })),
        note: note ?? "no Revit answers the host",
        picked: (id: string) => id === sessionId,
        pick: setPending,
      },
      {
        key: "document",
        label: doc?.title ?? null,
        placeholder: "choose a document",
        options: session
          ? (session.openDocuments ?? []).map((item) => ({
              id: item.openId,
              label: item.title,
              sub: item.isFamilyDocument ? "family" : "project",
            }))
          : null,
        note: session ? "nothing open here" : "choose a session first",
        picked: (id: string) => id === bound?.openId,
        pick,
      },
    ],
  };
}

/* ── verbs ─────────────────────────────────────────────────────────────────── */

const DONE_FADE_MS = 5000;

/** A verb button with its flag: refused persists until Esc or the next press; busy counts; done fades. */
export function SituationAction({
  handle,
  name,
  action,
  commit,
}: {
  handle: RouteHandle<any, any, any, any>;
  name: string;
  action: ActionHandle;
  commit?: boolean;
}) {
  const outcome = handle.outcome?.key === name ? handle.outcome : null;
  const busy = handle.busy?.key === name ? handle.busy : null;
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [faded, setFaded] = useState<number | null>(null);
  useEffect(() => {
    if (!outcome || outcome.refusal) return;
    const timer = setTimeout(() => setFaded(outcome.at), DONE_FADE_MS);
    return () => clearTimeout(timer);
  }, [outcome]);
  const shown =
    busy !== null ||
    (outcome !== null &&
      dismissed !== outcome.at &&
      (outcome.refusal !== null || faded !== outcome.at));
  const refusedNow =
    outcome?.refusal !== null && outcome?.refusal !== undefined && dismissed !== outcome.at;
  const stopped = action.refusal !== null || (handle.busy !== null && busy === null);
  return (
    <Popover.Root
      open={shown}
      onOpenChange={(next) => !next && outcome && setDismissed(outcome.at)}
    >
      <Popover.Trigger
        render={
          <Press
            frame="line"
            tone={commit ? "neutral" : "quiet"}
            size="value"
            state={stopped ? "disabled" : "rest"}
            aria-disabled={stopped}
            data-tone={refusedNow ? "caution" : undefined}
            title={action.refusal ?? action.says}
            onClick={() => void action.run()}
            style={{
              fontWeight: commit ? 600 : undefined,
              borderStyle: stopped ? "dashed" : undefined,
              borderColor: refusedNow ? "var(--pe-caution)" : undefined,
            }}
          >
            {action.label}
            {action.count !== null ? (
              <span className="face-mono text-ink-2">{action.count}</span>
            ) : null}
          </Press>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="artifact"
            data-tone={outcome?.refusal ? "caution" : undefined}
            className="max-w-[60ch] rounded-lg px-3 py-1.5 t-prose ring-1 ring-line outline-none"
            style={outcome?.refusal ? { borderColor: "var(--pe-caution)" } : undefined}
          >
            {busy ? (
              <span className="flex items-baseline gap-3">
                <span>
                  running <span className="face-mono">{busy.seconds} s</span>
                </span>
                <Press
                  frame="line"
                  tone="quiet"
                  size="value"
                  title="stop waiting; the host call itself is not cancelled"
                  onClick={handle.stop}
                >
                  stop
                </Press>
              </span>
            ) : outcome?.refusal ? (
              <span>{outcome.refusal.message}</span>
            ) : outcome?.stopped ? (
              <span className="text-ink-2">{action.label} · stopped waiting; see the log</span>
            ) : (
              <span className="text-ink-2">{action.label} · ran</span>
            )}
            {!busy ? <span className="ml-3 face-mono text-ink-mute">Esc</span> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The small caps word that names a row or a column of the board. */
const Label = ({ children }: { children: ReactNode }) => (
  <span className="t-small t-upper text-ink-mute">{children}</span>
);

/** The disclosure glyph, one mark for every fold and projection in the head. */
const Turn = ({ open }: { open: boolean }) => (
  <span
    aria-hidden
    className={`inline-block face-mono transition-transform ${open ? "rotate-90" : ""}`}
  >
    ▸
  </span>
);

/** A noun the machine knows — a target kind, a Reading, an actor — as a fact chip, not prose. */
const Noun = ({ children, title }: { children: ReactNode; title: string }) => (
  <FactChip title={title}>{children}</FactChip>
);

/**
 * The verb row, and its projection. Closed: the buttons in one row with the stage's ready count.
 * Open: the same buttons stood vertically, each with why it is refused (or what it does) and what
 * it dispatches and where — actor, the target it needs, the Readings it dirties, its chord. The
 * buttons are the same `SituationAction`s, so a flag grows from the same place in either view.
 */
function ActionBoard({
  handle,
  verbs,
  commit,
  work,
}: {
  handle: RouteHandle<any, any, any, any>;
  verbs: readonly [string, ActionHandle][];
  commit?: string;
  /** Where Work stands, beside the verbs that move it ("r3 · 2 room edits staged"). */
  work: string;
}) {
  const [open, setOpen] = useState(false);
  const declared = (handle.manifest.actions ?? {}) as Record<
    string,
    RouteAction<unknown, string, unknown, never> | undefined
  >;
  const head = (
    <span className="w-[9rem]">
      <Press
        tone="quiet"
        size="label"
        aria-expanded={open}
        title={
          open
            ? "back to the row"
            : "stand the verbs up: why each is refused or what it does, and what it dispatches"
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Turn open={open} /> verbs
      </Press>
    </span>
  );
  const meter = <span className="t-small face-mono text-ink-mute">{work}</span>;
  if (!open)
    return (
      <div className="hairline-t flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
        {head}
        {verbs.map(([name, action]) => (
          <SituationAction
            key={name}
            handle={handle}
            name={name}
            action={action}
            commit={name === commit}
          />
        ))}
        {meter}
      </div>
    );
  return (
    <div className="hairline-t grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 py-1.5">
      {head}
      <Label>why</Label>
      <span className="flex items-baseline justify-between gap-3">
        <Label>dispatches</Label>
        {meter}
      </span>
      {verbs.map(([name, action]) => {
        const spec = declared[name];
        return (
          <Fragment key={name}>
            <span className="flex justify-start">
              <SituationAction
                handle={handle}
                name={name}
                action={action}
                commit={name === commit}
              />
            </span>
            <span
              className={`t-prose ${action.refusal ? "" : "text-ink-2"}`}
              data-tone={action.refusal ? "caution" : undefined}
            >
              {action.refusal ?? action.says}
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 t-small face-mono text-ink-mute">
              {spec ? (
                <>
                  {spec.actor === "human" ? (
                    <Noun title="a person runs this verb; Pea may only propose it">human</Noun>
                  ) : null}
                  needs
                  <Noun title={`the target this verb needs bound: ${spec.needs}`}>
                    {spec.needs}
                  </Noun>
                  → dirties
                  {spec.dirties.length
                    ? spec.dirties.map((key) => (
                        <Noun key={key} title={`${action.label} marks the ${key} Reading stale`}>
                          {key}
                        </Noun>
                      ))
                    : "nothing"}
                </>
              ) : (
                "—"
              )}
              {action.chord ? <kbd className="face-mono text-ink-2">{action.chord}</kbd> : null}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ── grids ─────────────────────────────────────────────────────────────────── */

/** Label gutter shared by every grid on the board, so columns line up across rows. */
const GUTTER = "grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 t-prose";

/** Rows of label → value: what is bound, how fresh, which revision. */
export function Ledger({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className={GUTTER}>
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>
            <Label>{label}</Label>
          </dt>
          <dd className="min-w-0 truncate text-ink-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The page log, newest first: time and kind in the gutter, then the verb and what it said. */
export function PageLog({ entries }: { entries: readonly LogEntry[] }) {
  if (!entries.length)
    return <span className="t-prose text-ink-mute">nothing has run on this page yet</span>;
  return (
    <div className={`${GUTTER} max-h-48 overflow-y-auto`}>
      {entries.map((entry, index) => (
        <div key={index} className="contents" data-tone={entry.refused ? "caution" : undefined}>
          <span className="flex items-baseline justify-between gap-2 t-small">
            <span className="face-mono text-ink-mute">{entry.at}</span>
            <span className="t-upper text-ink-mute">{entry.kind}</span>
          </span>
          <span className="min-w-0 truncate">
            <span className="text-ink">{entry.label}</span>{" "}
            <span className={entry.refused ? "" : "text-ink-2"}>{entry.says}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── the situation ─────────────────────────────────────────────────────────── */

export interface SituationProps {
  handle: RouteHandle<any, any, any, any>;
  /** The route's slots after the stage word, joined by the route's own words. */
  sentence: ReactNode;
  /** The document's complaint for the chain lamp; null = healthy. */
  health?: string | null;
  /** Diagnostic projection of the target selected by the sentence. */
  target: { session: string | null; document: string | null };
  /** A controller transition when changing stage has dependent state. */
  chooseStage?: (stage: string) => void;
  /** The verb that commits Work; drawn bold. */
  commit?: string;
  /**
   * Staged Work. When `count` is above zero the band under the verb row shows: the frame (count
   * and noun, revision, read freshness, commit, discard, conflict with reload) is drawn here and
   * `body` is what the route puts inside it (its staged rows).
   */
  work?: {
    count: number;
    /** Singular; pluralized by count ("room edit"). */
    noun: string;
    /** When the document was last read, as the route words it ("14:02:11 · stale"). */
    read?: string;
    /** Drop everything staged. The band's Discard verb. */
    discard: () => Promise<unknown>;
    body?: ReactNode;
  };
  /** Free content under the verb row, for routes without a Work frame. Prefer `work`. */
  band?: ReactNode;
  /** Lines for the ledger behind the state gauge: what is bound, how fresh, which revision. */
  ledger?: readonly (readonly [string, ReactNode])[];
}

export function Situation({
  handle,
  sentence,
  health,
  target,
  chooseStage,
  commit,
  work,
  band,
  ledger,
}: SituationProps) {
  const [page, setPage] = handle.page as [
    Record<string, unknown>,
    (p: Record<string, unknown>) => void,
  ];
  const stages = handle.manifest.stages ?? [];
  const stage = typeof page.stage === "string" ? page.stage : null;
  const word = stages.find((item) => item.key === stage)?.word ?? handle.manifest.name;
  const verbs = Object.entries(handle.actions).filter(
    ([, action]) => !action.stage || action.stage === stage,
  ) as [string, ActionHandle][];
  const staged = work && work.count > 0 ? work : null;
  const nounOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const commitAction = commit ? handle.actions[commit] : undefined;
  const workWord = `${handle.work.revision === null ? "unwritten" : `r${handle.work.revision}`}${
    staged ? ` · ${nounOf(staged.count, staged.noun)} staged` : ""
  }${handle.work.conflict ? " · changed elsewhere" : ""}`;
  return (
    <section aria-label="Situation" className="flex min-w-0 flex-col">
      <ArtifactFrame
        head={
          /* name line: the route on the left, the cluster on the right */
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <h1 className="t-head face-display text-ink">{handle.manifest.name}</h1>
            <Cluster
              handle={handle}
              lamp={
                <ChainLamp
                  handle={handle}
                  health={health}
                  session={target.session}
                  document={target.document}
                />
              }
              state={<Ledger rows={[...(ledger ?? []), ["work", workWord]]} />}
            />
          </div>
        }
      >
        {/* the board: sentence and verbs left, log right; the right half wraps under */}
        <div className="flex flex-wrap gap-x-10 gap-y-1 px-3 pt-2 pb-1">
          <div className="flex min-w-[32rem] flex-[3] flex-col">
            <p className="mb-1.5 t-prose text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
              {stages.length ? (
                <b>
                  <Picker
                    levels={[
                      {
                        key: "stage",
                        label: word,
                        placeholder: "choose a stage",
                        options: stages.map((item) => ({ id: item.key, label: item.word })),
                        picked: (id) => id === stage,
                        pick: (id) => (chooseStage ? chooseStage(id) : setPage({ stage: id })),
                      },
                    ]}
                  />
                </b>
              ) : (
                <b>{word}</b>
              )}{" "}
              {sentence}
            </p>
            <ActionBoard handle={handle} verbs={verbs} commit={commit} work={workWord} />
            {staged ? (
              <div
                className="hairline-t flex flex-col gap-1 py-1.5 t-prose"
                data-tone={handle.work.conflict ? "caution" : undefined}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="w-[9rem]">
                    <Label>staged</Label>
                  </span>
                  <span>
                    <b className="font-semibold text-ink">{nounOf(staged.count, staged.noun)}</b>
                    <span className="face-mono text-ink-mute">
                      {handle.work.revision !== null ? ` r${handle.work.revision}` : " unwritten"}
                      {staged.read ? ` · read ${staged.read}` : ""}
                    </span>
                  </span>
                  <span className="ml-auto flex items-baseline gap-2">
                    {handle.work.conflict ? (
                      <>
                        <span>another writer changed this Work; your last write did not land</span>
                        <Press frame="line" tone="quiet" size="value" onClick={handle.work.reload}>
                          reload
                        </Press>
                      </>
                    ) : (
                      <>
                        <Press
                          frame="line"
                          tone="quiet"
                          size="value"
                          state={handle.busy ? "disabled" : "rest"}
                          disabled={handle.busy !== null}
                          onClick={() => void staged.discard()}
                        >
                          discard
                        </Press>
                        {commitAction ? (
                          // The same verb as the row's; its flag grows from the row button, not here.
                          <Press
                            frame="line"
                            tone="neutral"
                            size="value"
                            state={
                              commitAction.refusal !== null || handle.busy ? "disabled" : "rest"
                            }
                            disabled={commitAction.refusal !== null || handle.busy !== null}
                            title={commitAction.refusal ?? commitAction.says}
                            onClick={() => void commitAction.run()}
                          >
                            {commitAction.label}
                          </Press>
                        ) : null}
                      </>
                    )}
                  </span>
                </div>
                {staged.body}
              </div>
            ) : null}
            {band}
          </div>
          <div className="flex min-w-[24rem] flex-[2] flex-col">
            <div className="hairline-t flex flex-col gap-1 py-1.5">
              <span className="flex items-baseline gap-2">
                <Label>log</Label>
                {handle.log.length ? (
                  <span className="t-small face-mono text-ink-mute">{handle.log.length}</span>
                ) : null}
              </span>
              <PageLog entries={handle.log} />
            </div>
          </div>
        </div>
      </ArtifactFrame>
    </section>
  );
}
