/** The Situation's verb row: each verb button with its flag, and the board that stands them up. */
import { Fragment, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { actionRecipe } from "#/components/lang/action-button";
import { FactChip } from "#/components/lang/chip";
import { Kbd } from "#/components/lang/kbd";
import { Press } from "#/components/lang/press";
import type { RouteAction } from "./manifest";
import type { ActionHandle, RouteHandle } from "./use-route";

const DONE_FADE_MS = 5000;

/** Route content a verb's refusal flag draws under its message, by verb name (ask A: push's stale cells). */
export const ActionFlag = createContext<Readonly<Record<string, ReactNode>>>({});

/** A verb button with its flag: refused persists until Esc or the next press; busy counts; done fades. */
export function SituationAction({
  handle,
  name,
  action,
  chord = action.chord,
  commit,
}: {
  handle: RouteHandle<any, any, any, any>;
  name: string;
  action: ActionHandle;
  /** The chord drawn beside it; defaults to the manifest's. A stage passes its own (`stage.ts`). */
  chord?: string;
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
      // A refusal that names cells draws on those cells; the verb only tints.
      (outcome.refusal !== null ? !outcome.refusal.cells?.length : faded !== outcome.at));
  const refusedNow = Boolean(outcome?.refusal) && dismissed !== outcome?.at;
  const stopped = action.refusal !== null || (handle.busy !== null && busy === null);
  const flag = useContext(ActionFlag)[name];
  const reason = `${action.refusal ?? action.says}${chord ? ` · ${chord}` : ""}`;
  return (
    <span className="group relative inline-flex">
      <Popover.Root open={shown} onOpenChange={(o) => !o && outcome && setDismissed(outcome.at)}>
        <Popover.Trigger
          render={
            <Press
              frame="line"
              tone={commit ? "neutral" : "quiet"}
              size="value"
              state={stopped ? "disabled" : "rest"}
              aria-disabled={stopped}
              data-tone={refusedNow ? "caution" : undefined}
              title={reason}
              onClick={() => void action.run()}
              style={{ fontWeight: commit ? 600 : undefined }}
            >
              {action.label}
              {action.count !== null ? (
                <span className="face-mono text-ink-2">{action.count}</span>
              ) : null}
            </Press>
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
              className="max-w-[60ch] rounded-lg px-3 py-1.5 t-prose ring-1 ring-line outline-none"
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
                    title="Signal the running operation. It stops at its next checkpoint; what it already wrote stands."
                    onClick={handle.stop}
                  >
                    stop
                  </Press>
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
      {stopped ? (
        <span role="tooltip" data-surface="artifact" className={actionRecipe().reason()}>
          {reason}
        </span>
      ) : null}
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
  /** Where Work stands, beside the verbs ("r3 · 2 room edits staged"); null draws no meter. */
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
            chord={chords?.[name] ?? action.chord}
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
        const chord = chords?.[name] ?? action.chord;
        return (
          <Fragment key={name}>
            <span className="flex justify-start">
              <SituationAction
                handle={handle}
                name={name}
                action={action}
                chord={chord}
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
              {chord ? <Kbd>{chord}</Kbd> : null}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
