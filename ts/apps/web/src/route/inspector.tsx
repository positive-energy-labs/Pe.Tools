/**
 * THE DEV INSPECTOR — the route's nouns, top to bottom, for a stranger who has never seen this
 * route. Target, Work, Reading, Action, Page, then what the last run left behind. It is a PANEL
 * BODY: the shell decides whether it sits in a popover or a side pane, so nothing here opens
 * itself and nothing here is a trigger.
 *
 * Two laws do the drawing. Every mark means one thing: the five-state mark (● ◐ ◍ ✕ ○) is the
 * ONLY thing that says what a Reading is, and the one hue on the page is a failure or a refusal.
 * And the needle never lies to look calm: a fact the `RouteHandle` does not carry is drawn as a
 * named stand-in (`Gap`), never as a blank or an invented value — a blank would read as safe
 * water. Relationships are drawn, not implied: an Action names the Readings it dirties and every
 * Reading names the Actions that dirty it, so a `stale (dirtied)` mark has a visible cause.
 *
 * Dev-only; `import.meta.env.DEV` gates the whole component so the production bundle carries no
 * inspection surface.
 */
import { useEffect, useState, type ReactNode } from "react";
import { exportSeed, type Reading } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { Code, stringify } from "#/components/lang/code";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { Section } from "#/components/lang/section";

import { PageLog } from "./situation-grids";
import type { RouteAction } from "./manifest";
import type { RouteHandle } from "./use-route";

/* ── Marks ─────────────────────────────────────────────────────────────────── */

/** One mark per lifecycle state; nothing else in this panel says what a Reading is. */
export const MARK: Record<Reading<unknown>["state"], string> = {
  failed: "✕",
  stale: "◍",
  loading: "◐",
  ready: "●",
  absent: "○",
};

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

/** What a Reading is, in one line. The deadline and the stale reason are the only clocks it has. */
function readingWord(reading: Reading<unknown>, now: number): string {
  if (reading.state === "ready") return "ready";
  if (reading.state === "loading")
    return reading.deadline >= now
      ? `loading · ${seconds(reading.deadline - now)} before deadline`
      : `loading · overdue ${seconds(now - reading.deadline)}`;
  if (reading.state === "stale") return `stale · ${reading.reason}`;
  if (reading.state === "failed") return `failed · ${reading.message}`;
  return "absent · never asked";
}

/* ── The honest blank ──────────────────────────────────────────────────────── */

/**
 * A fact the handle does not carry. It names what would replace it (house law 8: a stand-in says
 * what it stands in for) and rides the dashed seam, so it can never be read as a value.
 */
function Gap({ says }: { says: string }) {
  return (
    <span
      className="hairline-b seam-border text-ink-mute"
      title={`the RouteHandle does not carry this — ${says}`}
    >
      not carried
    </span>
  );
}

/** The one hue in this panel: the world disagrees. */
function Alarm({ children }: { children: ReactNode }) {
  return <span data-tone="alarm">{children}</span>;
}

/* ── Rows ──────────────────────────────────────────────────────────────────── */

/** One noun's one line, with its raw JSON one click away. */
function Row({ name, raw, children }: { name: string; raw?: unknown; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 border-b border-line py-[2px] last:border-b-0">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="w-28 shrink-0 t-small face-mono text-ink-2">{name}</span>
        <span className="min-w-0 flex-1 t-small">{children}</span>
        {raw === undefined ? null : (
          <Press
            type="button"
            tone="quiet"
            size="label"
            aria-expanded={open}
            title={`raw JSON of ${name}`}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="face-mono text-ink-mute">{open ? "{–}" : "{…}"}</span>
          </Press>
        )}
      </div>
      {open && raw !== undefined ? (
        <div className="mt-1 mb-1">
          <Code code={stringify(raw)} lang="json" title={name} />
        </div>
      ) : null}
    </div>
  );
}

/** Nothing-declared is a state, not a blank — and it says which noun the manifest left out. */
function None({ says }: { says: string }) {
  return <p className="m-0 py-[2px] t-small text-ink-mute">{says}</p>;
}

/** A clock, running only while something is actually counting. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/* ── The panel ─────────────────────────────────────────────────────────────── */

export function RouteInspector<W, R extends string, P, A extends string>(props: {
  handle: RouteHandle<W, R, P, A>;
}) {
  if (!import.meta.env.DEV) return null;
  return <InspectorBody {...props} />;
}

function InspectorBody<W, R extends string, P, A extends string>({
  handle,
}: {
  handle: RouteHandle<W, R, P, A>;
}) {
  const { manifest, resolution, work, readings, actions, busy, failure, outcome, demo } = handle;
  const readingEntries = Object.entries(readings) as [R, Reading<unknown>][];
  const actionEntries = Object.entries(actions) as [A, RouteHandle<W, R, P, A>["actions"][A]][];
  const waiting = readingEntries.some(([, reading]) => reading.state === "loading");
  const now = useNow(waiting || busy !== null);

  // The edge, read once and drawn from both ends: an Action declares what it dirties, so a
  // Reading can name what dirtied it. Nothing else in the app draws this pair.
  const dirtiedBy = new Map<string, A[]>();
  const dirties = new Map<A, readonly R[]>();
  for (const [name, action] of Object.entries(manifest.actions ?? {}) as [
    A,
    RouteAction<W, R, P, never>,
  ][]) {
    dirties.set(name, action.dirties);
    for (const key of action.dirties) dirtiedBy.set(key, [...(dirtiedBy.get(key) ?? []), name]);
  }

  const seed = () => {
    const observed: Partial<Record<R, unknown>> = {};
    for (const [key, value] of readingEntries)
      if (value.state === "ready") observed[key] = value.observation;
    return exportSeed({
      title: `${manifest.key} @ revision ${work.revision ?? "none"}`,
      work: work.doc,
      readings: observed,
      page: handle.page[0] as Partial<P>,
    } as never);
  };

  const target = resolution.kind === "resolved" ? resolution.target : null;
  const page = Object.entries((handle.page[0] ?? {}) as Record<string, unknown>);

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-label={`${manifest.name} route inspector`}>
      <PageLog entries={handle.log} manifest={manifest} />
      <Section
        label="Target"
        aside={
          demo ? (
            <FactChip tone="caution" dashed title="a seed stands in for the host; nothing is live">
              demo seed
            </FactChip>
          ) : null
        }
      >
        <Row name="needs" raw={resolution}>
          {manifest.needs ?? "nothing — this route runs on the host itself"}
        </Row>
        <Row name="resolution">
          {resolution.kind === "resolved" ? (
            <span className="text-ink-2">resolved · {target?.kind}</span>
          ) : resolution.kind === "checking" ? (
            <span className="text-ink-2">checking the inventory</span>
          ) : resolution.kind === "failed" ? (
            <Alarm>{resolution.message}</Alarm>
          ) : (
            <Alarm>{`choose a target — ${resolution.reason.replaceAll("-", " ")}`}</Alarm>
          )}
        </Row>
        <Row name="document">
          {target?.kind === "document" ? (
            <span className="face-mono">{target.ref.openId}</span>
          ) : (
            <span className="text-ink-mute">no document is bound</span>
          )}
        </Row>
        <Row name="title">
          <Gap says="ExecutionTarget carries session and openId only; the document's title and Address live in the inventory Reading" />
        </Row>
        <Row name="session">
          {target?.kind === "document" ? (
            <span className="face-mono">{target.ref.session}</span>
          ) : target?.kind === "session" ? (
            <span className="face-mono">{target.session}</span>
          ) : (
            <span className="text-ink-mute">no session is bound</span>
          )}
        </Row>
        <Row name="resolved by">
          <Gap says="TargetResolution records no provenance — whether the thread head, ?target, or a lone inventory candidate chose it, and at what time" />
        </Row>
      </Section>

      <Section label="Work">
        <Row name="key">
          <span className="face-mono">{manifest.key}</span>
          {manifest.work ? (
            <span className="text-ink-2"> · route-state {manifest.work.route}</span>
          ) : (
            <span className="text-ink-mute"> · this route owns no Work</span>
          )}
        </Row>
        <Row name="revision" raw={work.doc ?? undefined}>
          {work.revision === null ? (
            <span className="text-ink-mute">
              {manifest.work ? "not hydrated — no document has been read" : "no Work to revise"}
            </span>
          ) : (
            <span className="face-mono">{work.revision}</span>
          )}
        </Row>
        <Row name="conflict">
          {work.conflict ? (
            <Alarm>a write was refused on a stale revision; re-read before writing again</Alarm>
          ) : (
            <span className="text-ink-2">none — the last write matched the revision</span>
          )}
        </Row>
        <Row name="dirty since">
          <Gap says="no unsaved-edit clock is exposed; revision moves only when a write lands" />
        </Row>
      </Section>

      <Section
        label="Readings"
        aside={<span className="t-small face-mono text-ink-2">{readingEntries.length}</span>}
      >
        {readingEntries.length === 0 ? (
          <None says="this manifest declares no Readings — it observes nothing." />
        ) : (
          readingEntries.map(([key, reading]) => {
            const causes = dirtiedBy.get(key) ?? [];
            const request = manifest.readings?.[key];
            const subject =
              typeof request === "function"
                ? "a page-dependent subject"
                : (request?.kind ?? "an undeclared subject");
            const word = readingWord(reading, now);
            return (
              <Row key={key} name={key} raw={{ request, reading }}>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span
                    className={reading.state === "failed" ? "face-mono" : "face-mono text-ink-2"}
                    data-tone={reading.state === "failed" ? "alarm" : undefined}
                    title={word}
                  >
                    {MARK[reading.state]}
                  </span>
                  <span className={reading.state === "failed" ? undefined : "text-ink-2"}>
                    {word}
                  </span>
                  <span className="text-ink-mute">of {subject}</span>
                  {reading.state === "stale" && reading.reason === "dirtied" ? (
                    <span className="text-ink-mute">
                      · dirtied by{" "}
                      {causes.length > 0 ? causes.join(", ") : "an action outside this manifest"}
                      {work.revision === null ? "" : ` · Work is at revision ${work.revision}`}
                    </span>
                  ) : causes.length > 0 ? (
                    <span className="text-ink-mute">· dirtied by {causes.join(", ")}</span>
                  ) : null}
                </span>
              </Row>
            );
          })
        )}
        {readingEntries.some(([, reading]) => reading.state === "ready") ? (
          <p className="m-0 pt-1 t-small text-ink-mute">
            The age of a ready Reading is{" "}
            <Gap says="Reading.ready carries an observation but no observedAt, so no sounding here has a date" />
          </p>
        ) : null}
      </Section>

      <Section
        label="Actions"
        aside={<span className="t-small face-mono text-ink-2">{actionEntries.length}</span>}
      >
        {actionEntries.length === 0 ? (
          <None says="this manifest declares no Actions — nothing here can be run." />
        ) : (
          actionEntries.map(([key, action]) => {
            const touched = dirties.get(key) ?? [];
            return (
              <Row
                key={key}
                name={key}
                raw={{ label: action.label, says: action.says, dirties: touched }}
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span>{action.label}</span>
                  {action.chord ? (
                    <span className="face-mono text-ink-2">{action.chord}</span>
                  ) : (
                    <span className="text-ink-mute">no chord</span>
                  )}
                  {busy?.key === key ? (
                    <span className="text-ink-2">running · {busy.seconds}s</span>
                  ) : action.refusal === null ? (
                    <span className="text-ink-2">ready</span>
                  ) : (
                    <Alarm>{action.refusal}</Alarm>
                  )}
                  <span className="text-ink-mute">
                    · dirties {touched.length > 0 ? touched.join(", ") : "no Reading"}
                  </span>
                </span>
              </Row>
            );
          })
        )}
      </Section>

      <Section label="Page">
        {page.length === 0 ? (
          <None
            says={
              manifest.page
                ? "the Page is declared but holds nothing yet — no control on this route has been touched."
                : "this manifest declares no Page — it holds no view state."
            }
          />
        ) : (
          page.map(([key, value]) => (
            <Row key={key} name={key} raw={value}>
              <span className="face-mono text-ink-2">{stringify(value).replaceAll("\n", " ")}</span>
            </Row>
          ))
        )}
      </Section>

      <Section
        label="Last outcome"
        aside={
          <Press
            type="button"
            tone="quiet"
            size="label"
            title="copy this moment as a Seed — the Work, every ready Reading, and the Page"
            onClick={() => void navigator.clipboard?.writeText(seed())}
          >
            copy Seed
          </Press>
        }
      >
        {busy ? (
          <OutcomeLine kind="busy" label={busy.key} says={`${busy.seconds}s`} />
        ) : outcome ? (
          <OutcomeLine
            kind={outcome.refusal ? "refused" : "receipt"}
            label={outcome.label}
            says={outcome.refusal ? outcome.refusal.message : "ran"}
          />
        ) : (
          <None says="nothing has been run on this route yet." />
        )}
        {failure ? <OutcomeLine kind="error" label={failure.code} says={failure.message} /> : null}
      </Section>
    </div>
  );
}
