/**
 * THE STANDING LINE — one composition of the route chrome under comparison (`?shell=standing`).
 *
 * The whole head is ONE standing sentence: `[tone dot] [verdict] — [what a stranger would need to
 * know]`. It is derived from the whole RouteHandle in a fixed order (resolution, then busy, then
 * failure/outcome, then readings that are not live, then ready), so the line never ranks two truths
 * by accident: it reports the most blocking one and carries a plurality COUNT beside it for the
 * rest ("2 of 7 readings not live"). One word cannot rank several truths; the count admits that.
 *
 * Below the line sits at most ONE affordance, and it is the fix for the verdict the line just
 * stated — pick a document, retry the read, run the one thing that is runnable. Never a button row:
 * a row of verbs is a menu, and a menu is not an answer. Every other verb lives under `record`,
 * which is the honest record of the page: every Reading with its five-state mark, the Work
 * revision, every Action with its refusal sentence as its disabled title, and the last outcome.
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import type { Reading } from "@pe/agent-contracts";
import { Press } from "#/components/lang/press";
import { FactChip } from "#/components/lang/chip";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/lang/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/lang/command";
import { StateDot, VERDICT_INK } from "#/components/master-table/cells";
import type { VerdictTone } from "#/components/master-table/model";
import { dirty, useTargetInventory } from "#/readings";

import { RouteInspector } from "../inspector";
import { RouteHelpButton } from "../help";
import { RouteKeys } from "../keys";
import { useChooseTarget, useEmptyBody, useHostLamp, type ShellProps } from "../shell";
import { useRoute, type RouteHandle } from "../use-route";
import type { Refusal } from "../refusal";

/* ── Reading marks ─────────────────────────────────────────────────────────── */

/** Five states, five marks, one mark each. A mark drawn two ways would be two marks. */
const MARK: Record<Reading<unknown>["state"], { glyph: string; tone: VerdictTone; word: string }> =
  {
    ready: { glyph: "●", tone: "done", word: "ready" },
    loading: { glyph: "◐", tone: "ink", word: "loading" },
    stale: { glyph: "◍", tone: "caution", word: "stale" },
    failed: { glyph: "✕", tone: "alarm", word: "failed" },
    absent: { glyph: "○", tone: "mute", word: "absent" },
  };

/** What a Reading would say about itself, in one clause. */
const saysOf = (reading: Reading<unknown>): string =>
  reading.state === "ready"
    ? "read live"
    : reading.state === "loading"
      ? "asking now; showing the last answer"
      : reading.state === "stale"
        ? `last answer kept — ${reading.reason.replaceAll("-", " ")}`
        : reading.state === "failed"
          ? `the read failed — ${reading.message}`
          : "never read";

function Mark({ state }: { state: Reading<unknown>["state"] }) {
  const mark = MARK[state];
  return (
    <span className="face-mono" style={{ color: VERDICT_INK[mark.tone] }} title={mark.word}>
      {mark.glyph}
    </span>
  );
}

/* ── The verdict ───────────────────────────────────────────────────────────── */

type Fix =
  | { kind: "none" }
  | { kind: "pick-target"; label: string }
  | { kind: "retry-reading"; reading: string; label: string }
  | { kind: "run-action"; action: string; label: string };

interface Verdict {
  tone: VerdictTone;
  word: string;
  says: string;
  fix: Fix;
}

const CHOOSE: Record<string, string> = {
  missing: "This page works on a Revit document and none has been picked yet.",
  "session-gone": "The Revit that held this document is no longer running.",
  "document-closed": "That document was closed in Revit, so nothing can be read from it.",
  "wrong-document-kind": "The picked document is the wrong kind for this page.",
  ambiguous: "Two open documents match — the right one has to be named.",
};

/**
 * The whole handle, read in blocking order. Earlier clauses are strictly more blocking than later
 * ones: nothing can be read without a Target, nothing can be judged while a run is in flight, and a
 * refusal outranks a stale number because the refusal is why the number stopped moving.
 */
function verdictOf<W, R extends string, P, A extends string>(
  handle: RouteHandle<W, R, P, A>,
  failure: Refusal | null,
): Verdict {
  const { resolution, busy, outcome } = handle;
  const readings = Object.entries(handle.readings) as [R, Reading<unknown>][];
  const notLive = readings.filter(([, reading]) => reading.state !== "ready");
  const broken = notLive.find(([, reading]) => reading.state === "failed");
  const runnable = (
    Object.entries(handle.actions) as [A, RouteHandle<W, R, P, A>["actions"][A]][]
  ).filter(([, action]) => action.refusal === null);

  if (resolution.kind === "checking")
    return {
      tone: "ink",
      word: "checking",
      says: "Looking through the running copies of Revit for the document this page works on.",
      fix: { kind: "none" },
    };
  if (resolution.kind === "failed")
    return {
      tone: "alarm",
      word: "lost",
      says: `The list of open documents could not be read — ${resolution.message}`,
      fix: { kind: "pick-target", label: "Pick a document" },
    };
  if (resolution.kind === "choose")
    return {
      tone: "caution",
      word: "unbound",
      says: CHOOSE[resolution.reason] ?? `A target must be picked — ${resolution.reason}.`,
      fix: { kind: "pick-target", label: "Pick a document" },
    };
  if (busy)
    return {
      tone: "ink",
      word: "working",
      says: `${handle.actions[busy.key]?.label ?? busy.key} has been running for ${busy.seconds}s — nothing here is settled until it returns.`,
      fix: { kind: "none" },
    };

  const refused = failure ?? outcome?.refusal ?? null;
  if (refused)
    return {
      tone: "alarm",
      word: "refused",
      says: `${outcome ? `${outcome.label}: ` : ""}${refused.message} (${refused.code})`,
      // The fix for a refusal is the one thing still allowed. Offer it only when there IS one —
      // two would be a menu, none would be a button that lies.
      fix:
        runnable.length === 1 && runnable[0]
          ? { kind: "run-action", action: runnable[0][0], label: `Run ${runnable[0][1].label}` }
          : { kind: "none" },
    };
  if (broken)
    return {
      tone: "alarm",
      word: "unread",
      says: `${broken[0]} could not be read — ${broken[1].state === "failed" ? broken[1].message : ""}`,
      fix: { kind: "retry-reading", reading: broken[0], label: `Read ${broken[0]} again` },
    };
  const first = notLive[0];
  if (first)
    return {
      tone: "caution",
      word: "shoal",
      says: `What is shown was true when it was last read, not now — ${notLive.map(([key]) => key).join(", ")}.`,
      fix: { kind: "retry-reading", reading: first[0], label: `Read ${first[0]} again` },
    };
  if (outcome)
    return {
      tone: "done",
      word: "ran",
      says: `${outcome.label} ran against this document and everything shown was read back live.`,
      fix: { kind: "none" },
    };
  return {
    tone: "done",
    word: "live",
    says:
      readings.length === 0
        ? "This page is bound and asks nothing of Revit — there is nothing here to go stale."
        : `All ${readings.length} readings on this page were answered by Revit live.`,
    fix: { kind: "none" },
  };
}

/* ── The one affordance ────────────────────────────────────────────────────── */

/**
 * Every open document in every running Revit, searchable, sorted by session then address, and
 * keyboard-navigable (cmdk owns the cursor; Enter picks, Esc leaves). Picking writes `?target`,
 * the same param the Instances body writes — the one wiring the substrate has today.
 */
function TargetPicker({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const inventory = useTargetInventory();
  const [target, chooseTarget] = useChooseTarget();
  const rows = useMemo(() => {
    if (inventory.kind !== "ready") return [];
    return Object.entries(inventory.sessions)
      .flatMap(([session, found]) =>
        found.kind === "ready"
          ? found.values.map((doc) => ({
              session,
              openId: doc.openId,
              address: doc.address as string | null,
              kind: doc.kind as string,
            }))
          : [{ session, openId: "", address: null, kind: "unreadable" }],
      )
      .sort((a, b) =>
        a.session === b.session
          ? String(a.address ?? a.openId).localeCompare(String(b.address ?? b.openId))
          : a.session.localeCompare(b.session),
      );
  }, [inventory]);
  return (
    <>
      <Press
        tone="neutral"
        size="value"
        onClick={() => setOpen(true)}
        title="every document open in every running Revit — type to narrow, Enter to pick"
      >
        <Search className="mr-1 inline size-3.5 align-[-2px]" />
        {label}
      </Press>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent pad="none">
          <DialogHeader>
            <DialogTitle>Which document should this page work on?</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search open documents by Revit session or path…" autoFocus />
            <CommandList>
              <CommandEmpty>
                {inventory.kind === "ready"
                  ? "No open document matches. Open one in Revit, or clear the search."
                  : inventory.kind === "failed"
                    ? `The document list could not be read — ${inventory.message}`
                    : "Still asking every running Revit what it has open…"}
              </CommandEmpty>
              <CommandGroup heading="Open documents">
                {rows.map((row) => (
                  <CommandItem
                    key={`${row.session}:${row.openId}`}
                    value={`${row.session} ${row.address ?? row.openId} ${row.kind}`}
                    onSelect={() => {
                      setOpen(false);
                      chooseTarget(row.address ?? row.session);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{row.address ?? row.openId}</span>
                    <span className="face-mono t-small text-ink-2">
                      {row.kind} · {row.session}
                      {row.address === target || row.session === target ? " · picked" : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Affordance<W, R extends string, P, A extends string>({
  fix,
  handle,
}: {
  fix: Fix;
  handle: RouteHandle<W, R, P, A>;
}) {
  if (fix.kind === "none") return null;
  if (fix.kind === "pick-target") return <TargetPicker label={fix.label} />;
  if (fix.kind === "retry-reading") {
    const request = handle.manifest.readings?.[fix.reading as R];
    if (!request) return null;
    return (
      <Press
        tone="neutral"
        size="value"
        title={`ask Revit for ${fix.reading} again; what is on screen now is the last answer`}
        onClick={() => dirty(request)}
      >
        {fix.label}
      </Press>
    );
  }
  const action = handle.actions[fix.action as A];
  return (
    <Press tone="neutral" size="value" title={action.says} onClick={() => void action.run()}>
      {fix.label}
    </Press>
  );
}

/* ── The record ────────────────────────────────────────────────────────────── */

function Record<W, R extends string, P, A extends string>({
  handle,
  failure,
}: {
  handle: RouteHandle<W, R, P, A>;
  failure: Refusal | null;
}) {
  const readings = Object.entries(handle.readings) as [R, Reading<unknown>][];
  const actions = Object.entries(handle.actions) as [A, RouteHandle<W, R, P, A>["actions"][A]][];
  const [inspecting, setInspecting] = useState(false);
  return (
    <details className="min-w-0">
      <summary className="t-small text-ink-2 select-none">record</summary>
      <div className="mt-1.5 flex flex-col gap-2 border border-line p-2">
        <dl className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2.5 gap-y-0.5 t-small">
          {readings.length === 0 ? (
            <dd className="col-span-3 text-ink-mute">
              This page declares no Readings — it asks Revit for nothing.
            </dd>
          ) : null}
          {readings.map(([key, reading]) => (
            <div key={key} className="col-span-3 grid grid-cols-subgrid">
              <dt>
                <Mark state={reading.state} />
              </dt>
              <dd className="face-mono text-ink">{key}</dd>
              <dd className="truncate text-ink-2">{saysOf(reading)}</dd>
            </div>
          ))}
        </dl>

        <div className="t-small text-ink-2">
          Work <span className="face-mono text-ink">{handle.manifest.work?.route ?? "none"}</span>
          {" · revision "}
          <span className="face-mono text-ink">{handle.work.revision ?? "—"}</span>
          {handle.work.conflict ? (
            <span data-tone="alarm"> · another writer changed it under you</span>
          ) : null}
          {handle.demo ? <span> · seeded, not read from Revit</span> : null}
        </div>

        {actions.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {actions.map(([key, action]) => {
              const stopped = action.refusal !== null || handle.busy !== null;
              return (
                <Press
                  key={key}
                  tone="quiet"
                  size="label"
                  state={stopped ? "disabled" : "rest"}
                  aria-disabled={stopped}
                  title={
                    action.refusal ?? (handle.busy ? `${handle.busy.key} is running` : action.says)
                  }
                  onClick={() => void action.run()}
                >
                  {action.label}
                  {action.chord ? <span className="face-mono"> {action.chord}</span> : null}
                </Press>
              );
            })}
          </div>
        ) : null}

        <div className="t-small text-ink-2" role="status" aria-label="Action outcome">
          {failure
            ? `last: ${failure.code} — ${failure.message}`
            : handle.outcome
              ? `last: ${handle.outcome.label} — ${handle.outcome.refusal?.message ?? "ran"}`
              : "last: nothing has been run on this page yet"}
        </div>

        {(handle.manifest.views ?? []).map((view) => (
          <div key={view.key}>{view.draws({ readings: handle.readings })}</div>
        ))}

        {import.meta.env.DEV ? (
          <>
            <Press tone="quiet" size="label" onClick={() => setInspecting(true)}>
              inspector
            </Press>
            <Dialog open={inspecting} onOpenChange={setInspecting}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{handle.manifest.name} — inspector</DialogTitle>
                </DialogHeader>
                <RouteInspector handle={handle} />
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </div>
    </details>
  );
}

/* ── The shell ─────────────────────────────────────────────────────────────── */

export function StandingShell<W, R extends string, P, A extends string>({
  manifest,
  name,
  aside,
  live,
  children,
}: ShellProps<W, R, P, A>) {
  const [chosenTarget] = useChooseTarget();
  const handle = useRoute(manifest, { target: chosenTarget });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const empty = useEmptyBody(handle);
  const lamp = useHostLamp(live ?? true);
  const failure = refusal ?? handle.failure;
  const verdict = verdictOf(handle, failure);

  const readings = Object.entries(handle.readings) as [R, Reading<unknown>][];
  const notLive = readings.filter(([, reading]) => reading.state !== "ready").length;

  return (
    <div
      role="region"
      aria-label={`${manifest.name} route`}
      className="flex h-full min-h-0 min-w-0 flex-col gap-2"
    >
      <RouteKeys handle={handle} onRefusal={setRefusal} />

      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {/* THE STANDING LINE. One sentence, read aloud: dot, word, what it means for you. */}
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1" role="status">
            <span className="shrink-0 self-center">
              <StateDot tone={verdict.tone} />
            </span>
            <span
              className={`t-head face-display shrink-0 ${verdict.tone === "alarm" ? "" : "text-ink"}`}
              data-tone={verdict.tone === "alarm" ? "alarm" : undefined}
            >
              {name ?? manifest.name} · {verdict.word}
            </span>
            <span className="t-prose min-w-0 text-ink-2">— {verdict.says}</span>
            {/* One word cannot rank several truths; the count carries the plurality. */}
            {notLive > 0 ? (
              <FactChip
                dashed
                title="open the record below for which ones, and why each is not live"
              >
                {notLive} of {readings.length} readings not live
              </FactChip>
            ) : null}
          </p>

          {verdict.fix.kind === "none" ? null : (
            <div className="flex min-w-0 items-center gap-2">
              <Affordance fix={verdict.fix} handle={handle} />
            </div>
          )}

          <Record handle={handle} failure={failure} />
        </div>

        <span className="flex shrink-0 items-center gap-3">
          {aside}
          {/* The lamp. Host status ONLY — it never speaks for the route. */}
          <FactChip title={lamp.says}>
            <span className="flex items-center gap-1.5">
              <StateDot tone={lamp.tone} />
              <span>
                host · {lamp.word}
                {lamp.checked ? ` · ${lamp.checked}` : ""}
              </span>
            </span>
          </FactChip>
          {/* The one route-wide control group: tutorial, inspector (in the record), theme. */}
          <span className="flex items-center gap-1">
            <RouteHelpButton name={manifest.name} docs={manifest.docs} />
            <ThemeToggle />
          </span>
        </span>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{empty ?? children}</div>
    </div>
  );
}
