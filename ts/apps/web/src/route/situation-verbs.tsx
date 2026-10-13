/** The Situation's verb row: each verb button with its flag, and the board that stands them up. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import type { LucideIcon } from "lucide-react";
import { FactChip } from "#/components/lang/chip";
import { Kbd } from "#/components/lang/kbd";
import { Button } from "#/components/lang/button";
import { changedInRevit } from "#/readings";
import type { RouteAction } from "./manifest";
import type { ActionHandle, RouteHandle } from "./use-route";
import { useSituationPresentation } from "#/navigation/route-controls";

const DONE_FADE_MS = 5000;

/** A verb's standing question, by verb name, drawn in its flag (ruling 39: apply's stale cells). */
export const ActionFlag = createContext<Readonly<Record<string, ReactNode>>>({});

/** A verb button with its flag: refused persists until Esc or the next press; busy counts; done fades. */
export function SituationAction({
  handle,
  name,
  action,
  chord = action.chord,
  commit,
  icon: Icon,
  tone: standing,
}: {
  handle: RouteHandle<any, any, any, any>;
  name: string;
  action: ActionHandle;
  /** The chord drawn beside it; defaults to the manifest's. A stage passes its own (`stage.ts`). */
  chord?: string;
  commit?: boolean;
  /** Draw the verb as a single-icon press (kaitpw, 2026-10-12: new, fork, send). The label is
   *  its accessible name; the title still says what it does, why it is refused, and its chord. */
  icon?: LucideIcon;
  /** The verb's standing tone (Stop's alarm); a refusal or a stale read's caution outranks it. */
  tone?: "alarm";
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
  const flag = useContext(ActionFlag)[name];
  const presented = useSituationPresentation(handle.manifest.key);
  // A route's standing question for this verb (schedules' stale resolve) holds its popover open.
  const shown =
    busy !== null ||
    flag !== undefined ||
    (outcome !== null &&
      dismissed !== outcome.at &&
      // A refusal that names cells draws on those cells; the verb only tints.
      (outcome.refusal !== null ? !outcome.refusal.cells?.length : faded !== outcome.at));
  const refusedNow = Boolean(outcome?.refusal) && dismissed !== outcome?.at;
  const stopped = action.refusal !== null || (handle.busy !== null && busy === null);
  // The read verb wears Revit's change mark on what it reads (MAP ruling 5); never a second button.
  const rereads = (handle.manifest.actions as Record<string, { rereads?: string } | undefined>)?.[
    name
  ]?.rereads;
  const stale =
    rereads === undefined
      ? false
      : rereads in handle.readings
        ? changedInRevit(handle.readings[rereads])
        : rereads === "work" && handle.work.changed;
  const reason = `${action.refusal ?? `${stale ? "Revit changed this document since the last read. " : ""}${action.says}`}${chord ? ` · ${chord}` : ""}`;
  const refusal = stopped ? (action.refusal ?? "Another action is running") : null;
  const tone = refusedNow || stale ? "caution" : standing;
  return (
    <span className="relative inline-flex">
      <Popover.Root
        open={shown && presented}
        onOpenChange={(o) => !o && presented && outcome && setDismissed(outcome.at)}
      >
        <Popover.Trigger
          render={
            Icon ? (
              // One glyph (kaitpw, 2026-10-12): the label is its name and its tooltip.
              <Button
                kind={commit ? "commit" : "framed"}
                icon={Icon}
                label={`${action.label}: ${action.says}${chord ? ` · ${chord}` : ""}`}
                refusal={refusal}
                data-tone={tone}
                onClick={() => void action.run()}
              />
            ) : (
              <Button
                kind={commit ? "commit" : "framed"}
                label={action.label}
                reason={reason}
                refusal={refusal === null ? null : reason}
                data-tone={tone}
                onClick={() => void action.run()}
              >
                <span className="t-sentence">{action.label}</span>
                {action.count !== null ? (
                  <span className="face-mono text-ink-2">{action.count}</span>
                ) : null}
              </Button>
            )
          }
        />
        <Popover.Portal>
          <Popover.Positioner
            side="bottom"
            align="start"
            sideOffset={6}
            className="isolate z-popup"
          >
            <Popover.Popup
              data-surface="artifact"
              data-tone={outcome?.refusal ? "caution" : undefined}
              className="max-w-[60ch] px-3 py-1.5 t-prose float-surface"
            >
              {busy ? (
                <span className="flex items-baseline gap-3">
                  <span>
                    running <span className="face-mono">{busy.seconds} s</span>
                  </span>
                  <Button
                    kind="framed"
                    label="stop"
                    reason="Signal the running operation. It stops at its next checkpoint; what it already wrote stands."
                    onClick={handle.stop}
                  >
                    stop
                  </Button>
                </span>
              ) : outcome?.refusal ? (
                <span>
                  {outcome.refusal.message}
                  {outcome.refusal.detail ? (
                    <details className="t-small text-ink-2">
                      <summary>detail</summary>
                      <span>{outcome.refusal.detail}</span>
                    </details>
                  ) : null}
                  {flag}
                </span>
              ) : flag !== undefined ? (
                flag
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
    </span>
  );
}

/** The small caps word that names a row or a column of the board. */
export const Label = ({ children }: { children: ReactNode }) => (
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
export function ActionBoard({
  handle,
  verbs,
  chords,
  commit,
  work,
}: {
  handle: RouteHandle<any, any, any, any>;
  verbs: readonly [string, ActionHandle][];
  /** The chords the stage node binds, by verb; a route-bound chord comes off the action. */
  chords?: Readonly<Record<string, string | undefined>>;
  commit?: string;
  /** Where Work stands, beside the verbs ("r3"; the Work sentence owns counts); null draws no meter. */
  work: string | null;
}) {
  const [open, setOpen] = useState(false);
  const meter = work ? <span className="t-small face-mono text-ink-mute">{work}</span> : null;
  const declared = (handle.manifest.actions ?? {}) as Record<
    string,
    RouteAction<unknown, string, unknown, never> | undefined
  >;
  const head = (
    <span className="w-[9rem]">
      <Button
        label="verbs"
        aria-expanded={open}
        reason={
          open
            ? "back to the row"
            : "stand the verbs up: why each is refused or what it does, and what it dispatches"
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Turn open={open} /> verbs
      </Button>
    </span>
  );
  return (
    <div className="pe-action-board hairline-t" data-expanded={open}>
      {head}
      {meter}
      {verbs.map(([name, action]) => {
        const spec = declared[name];
        const chord = chords?.[name] ?? action.chord;
        return (
          <div key={name} className="pe-action-board-item">
            <span className="flex justify-start">
              <SituationAction
                handle={handle}
                name={name}
                action={action}
                chord={chord}
                commit={name === commit}
              />
            </span>
            <div className="pe-action-board-detail" aria-hidden={!open} inert={!open}>
              <div className="pe-action-board-detail-inner">
                <span
                  className={`t-prose ${action.refusal ? "" : "text-ink-2"}`}
                  data-tone={action.refusal ? "caution" : undefined}
                >
                  {action.refusal ?? action.says}
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 t-small face-mono text-ink-mute">
                  {spec ? (
                    <>
                      {action.actor === "human" ? (
                        <Noun title="a person runs this verb; Pea may only propose it">human</Noun>
                      ) : null}
                      needs
                      <Noun title={`the target this verb needs bound: ${action.needs}`}>
                        {action.needs}
                      </Noun>
                      → dirties
                      {spec.dirties.length
                        ? spec.dirties.map((key) => (
                            <Noun
                              key={key}
                              title={`${action.label} marks the ${key} Reading stale`}
                            >
                              {key}
                            </Noun>
                          ))
                        : "nothing"}
                    </>
                  ) : (
                    "—"
                  )}
                  {chord ? <Kbd>{chord}</Kbd> : null}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
