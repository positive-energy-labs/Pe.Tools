/**
 * PROTOTYPE — root/container anatomy lineup (unification review, surface partner, 2026-09-16).
 * THROWAWAY. Three structurally different roots, same content, same light, one keypress apart.
 *
 *   A  gutter grid, composer IN FLOW as the transcript pane's foot
 *   B  gutter grid, composer OVERLAY over the transcript with today's scrim
 *   C  uniform enclosure: every region is an artifact frame on page ground; the gutter is the ground
 *
 * Tunables ride the URL: gutter, halo, rail, side (open|rail), proposals, width.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Activity, Suspense, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Paperclip, X } from "lucide-react";

import { Pane, type PaneShortcut } from "#/components/lang/pane";
import { PaneResizeHandle } from "#/components/lang/pane-resize";
import { artifactFrameRecipe, ArtifactFrame } from "#/components/lang/artifact-frame";
import { ActionButton } from "#/components/lang/action-button";
import { FactChip, Tag } from "#/components/lang/chip";
import { Code } from "#/components/lang/code";
import { HelpTip } from "#/components/lang/help";
import { Input } from "#/components/lang/input";
import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import { Textarea } from "#/components/lang/textarea";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { EmptyState } from "#/components/lang/empty";
import { MasterTable } from "#/components/master-table/master-table";
import { StateDot } from "#/components/master-table/cells";
import type { Column } from "#/components/master-table/model";
import { ThreadList } from "#/chat/thread-palette";
import { Picker } from "#/route/picker";
import { RouteHelpButton } from "#/route/help";
import { PARAM_ROWS, cellProps, type ParamRow } from "#/design-system/specimens-data";
import { emptyManifest } from "#/route";

export const manifest = emptyManifest("prototype-root", "Root lineup");

const VARIANTS = ["A", "B", "C"] as const;
type Variant = (typeof VARIANTS)[number];
const LABEL: Record<Variant, string> = {
  A: "gutter grid · composer in flow",
  B: "gutter grid · composer overlay + scrim",
  C: "uniform enclosure · frames on ground",
};

const search = z.object({
  variant: z.enum(VARIANTS).default("A").catch("A"),
  gutter: z.coerce.number().default(8).catch(8),
  halo: z.coerce.number().default(6).catch(6),
  /** colour treatment of the three gutter states: resting, focused region, keyboard help */
  tone: z.enum(["fill", "line"]).default("fill").catch("fill"),
  /** force the keyboard-help state on the focused pane (screenshot aid) */
  help: z.coerce.number().default(0).catch(0),
  rail: z.coerce.number().default(24).catch(24),
  side: z.enum(["open", "rail"]).default("open").catch("open"),
  proposals: z.coerce.number().default(0).catch(0),
  width: z.coerce.number().default(0).catch(0),
  thread: z.string().default("t1").catch("t1"),
  mode: z.enum(["threads", "trace", "world"]).default("threads").catch("threads"),
  /** The transcript pane body's state; loading is a real Suspense boundary. */
  body: z.enum(["ready", "loading", "error", "empty"]).default("ready").catch("ready"),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute("/prototype-root")({
  validateSearch: search,
  component: Lineup,
});

/* ── fixture content ─────────────────────────────────────────────────────── */

const THREADS = [
  { id: "t1", title: "project-a · zone takeoff, level 2", updatedAt: "2026-09-16T10:02:00Z" },
  { id: "t2", title: "VAV box family · body width", updatedAt: "2026-09-16T09:11:00Z" },
  { id: "t3", title: "Schedule grid · mech equipment", updatedAt: "2026-09-15T17:40:00Z" },
  { id: "t4", title: "Parameter links · profile B", updatedAt: "2026-09-15T12:03:00Z" },
  { id: "t5", title: "Sheet index audit", updatedAt: "2026-09-14T16:20:00Z" },
  { id: "t6", title: "older thread", updatedAt: "2026-09-10T16:20:00Z" },
];

const TOOL_RESULT = {
  op: "revit.rooms.list",
  target: { session: "pe-revit-2", document: "project-a-MEP.rvt" },
  rooms: [
    { number: "201", name: "OFFICE", area: 214.5, zone: "AHU-2" },
    { number: "202", name: "CONF", area: 388.1, zone: "AHU-2" },
    { number: "203", name: "STOR", area: 61.9, zone: null },
  ],
};

const useColumns = () =>
  useMemo<Column<ParamRow>[]>(
    () => [
      {
        key: "param",
        label: "parameter",
        title: "The parameter as Revit names it.",
        width: "w-40",
        lock: true,
        sort: (r) => r.param,
        search: (r) => r.param,
        cell: (r) => <span className="px-1.5 py-1 t-small text-ink">{r.param}</span>,
      },
      {
        key: "scope",
        label: "scope",
        title: "Type-level or instance-level.",
        width: "w-20",
        facet: (r) => r.scope,
        cell: (r) => <span className="px-1.5 py-1 t-small face-mono text-ink-2">{r.scope}</span>,
      },
      {
        key: "value",
        label: "value",
        title: "The value with every mark the grammar makes.",
        state: cellProps,
        sort: (r) => r.value,
        search: (r) => r.value,
      },
    ],
    [],
  );

/* ── pane body states (user verdict 2026-09-16: loading, error, empty are distinct) ── */

const NEVER = new Promise<never>(() => {});
/** A thread's body arrives ~700ms after it is selected; the promise is cached per thread so a
 * revisit is instant (Suspense semantics: the cache, not the boundary, decides). */
const loaded = new Map<string, Promise<void>>();
const bodyOf = (thread: string) => {
  let p = loaded.get(thread);
  if (!p) {
    p = new Promise<void>((r) => setTimeout(r, 700));
    loaded.set(thread, p);
  }
  return p;
};
function Await({ thread, forever, children }: { thread: string; forever: boolean; children: ReactNode }) {
  use(forever ? NEVER : bodyOf(thread));
  return <>{children}</>;
}
/** The one loading mark: names what is loading, inside the body, under the pane's own head. */
function Loading({ what }: { what: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 t-small t-upper text-ink-mute" role="status" aria-live="polite">
      <span className="animate-pulse">loading {what}…</span>
    </div>
  );
}
function BodyError({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6" role="alert">
      <span className="t-small t-upper" data-tone="alarm">{what} failed to load</span>
      <span className="t-small text-ink-2">the host did not answer /threads/t1 — 502</span>
      <Press frame="line" tone="quiet" size="value" onClick={retry}>retry</Press>
    </div>
  );
}

/* ── the pieces ──────────────────────────────────────────────────────────── */

function Transcript({ tail, thread, body, set }: { tail?: ReactNode; thread: string; body: Search["body"]; set: (p: Partial<Search>) => void }) {
  const columns = useColumns();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {body === "error" ? (
        <BodyError what="thread" retry={() => set({ body: "ready" })} />
      ) : body === "empty" ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState story="scope" exit="ask anything below, or pick a thread on the left">no messages in this thread yet</EmptyState>
        </div>
      ) : (
      <Suspense fallback={<Loading what="thread" />}>
      <Await thread={thread} forever={body === "loading"}>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-3 t-prose text-ink">
        <p className="text-ink-2">
          <b className="text-ink">you</b> · list the rooms on level 2 and stage the ones without a
          zone
        </p>
        <p className="mt-3">
          <b data-tone="pea">Pea</b> · I read the open document. Three rooms answer on level 2; one
          has no zone assignment. Here is the call and what it returned.
        </p>
        <div className="mt-2">
          <Code lang="json" code={JSON.stringify(TOOL_RESULT, null, 2)} />
        </div>
        <p className="mt-3">
          Staging <b>203 STOR</b> to <b>AHU-2</b> needs your approval. The plan below is the table
          the route would show; it is the same primitive nested inside the transcript.
        </p>
        <div className="mt-2">
          <ArtifactFrame
            head={
              <>
                <Tag>level 2 · plan</Tag>
                <FactChip title="rows in scope">{PARAM_ROWS.length} params</FactChip>
                <FactChip dashed title="fixture data">
                  fixture
                </FactChip>
              </>
            }
            foot={<Tag>1 staged · 0 refused</Tag>}
          >
            <div className="flex h-56 flex-col">
              <MasterTable
                rows={PARAM_ROWS.slice(0, 6)}
                columns={columns}
                rowKey={(r) => r.key}
                scopeLabel="params"
                searchPlaceholder="search…"
              />
            </div>
          </ArtifactFrame>
        </div>
        <p className="mt-3 text-ink-2">
          <b className="text-ink">you</b> · ok, and what about the corridor?
        </p>
        <p className="mt-3">
          <b data-tone="pea">Pea</b> · The corridor is not a room in this model; it is unbounded
          space. I can propose a room separation line, which is a write.
        </p>
        <div className="h-24" />
      </div>
      </Await>
      </Suspense>
      )}
      {tail}
    </div>
  );
}

const DOC_LEVELS = [
  {
    key: "session",
    label: "pe-revit-2",
    placeholder: "choose a session",
    options: [
      { id: "s1", label: "pe-revit-2", sub: "2 open" },
      { id: "s2", label: "pe-revit-7", sub: "1 open" },
    ],
    picked: (id: string) => id === "s1",
    pick: () => {},
  },
  {
    key: "document",
    label: "project-a-MEP.rvt",
    placeholder: "choose a document",
    options: [
      { id: "d1", label: "project-a-MEP.rvt", sub: "project" },
      { id: "d2", label: "VAV-box.rfa", sub: "family" },
    ],
    picked: (id: string) => id === "d1",
    pick: () => {},
  },
];

/** The composer: Situation as its one-rail head, proposals band as a stress case, control row foot. */
function Composer({ proposals, thread, set }: { proposals: number; thread: string; set: (p: Partial<Search>) => void }) {
  const [text, setText] = useState("");
  const title = THREADS.find((t) => t.id === thread)?.title ?? thread;
  // The thread is a slot in the sentence, bound to the same `?thread` the sidebar projects: one
  // owner (the URL), two writers (sentence picker, sidebar row). Root review 2026-09-16.
  const threadLevel = [
    {
      key: "thread",
      label: title,
      placeholder: "choose a thread",
      options: THREADS.map((t) => ({ id: t.id, label: t.title, sub: t.updatedAt.slice(0, 10) })),
      picked: (id: string) => id === thread,
      pick: (id: string) => set({ thread: id }),
    },
  ];
  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="hairline-x-faint hairline-y-faint flex flex-col overflow-hidden rounded-sm"
      data-surface="artifact"
      data-proto="composer"
    >
      {/* Situation · one rail high by default */}
      <section
        aria-label="Situation"
        className="hairline-b flex shrink-0 items-center gap-3 px-3"
        style={{ height: "var(--rail)" }}
      >
        <p className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap t-prose text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
          <b>Pea</b>&nbsp;on&nbsp;
          <Picker levels={DOC_LEVELS} title="session › document; pick to change" />
          &nbsp;in&nbsp;
          <span data-proto="thread-slot" className="min-w-0 truncate">
            <Picker levels={threadLevel} title="the open thread; pick to switch — the sidebar follows" />
          </span>
        </p>
        <span className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5 t-small face-mono text-ink-2" title="host · Revit attached\nsession · pe-revit-2\ndocument · healthy">
            <StateDot tone="done" /> project-a-MEP.rvt
          </span>
          <HelpTip>
            Chat runs without a Revit target; Revit operations need a document. Enter sends, Shift+Enter
            breaks a line, / offers skills.
          </HelpTip>
          <RouteHelpButton name="Root lineup" />
          <ThemeToggle />
        </span>
      </section>
      {proposals > 0 ? (
        <div aria-label="Pea proposals" className="hairline-b flex flex-col gap-1 px-3 py-2 t-prose">
          <span>
            <b>{proposals} proposal{proposals === 1 ? "" : "s"}</b> waiting on you
          </span>
          {Array.from({ length: proposals }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-3">
              <span className="face-mono text-ink">
                ⌗ {i === 0 ? "revit.rooms.set-zone" : "revit.rooms.separation-line"}
              </span>
              <code className="face-mono t-small text-ink">project-a-MEP.rvt</code>
              <span className="t-small text-ink-2">approval</span>
              <ActionButton
                tone="commit"
                icon={Check}
                label="allow once"
                reason="Let pea run this call against the live target"
                onClick={() => {}}
              />
              <ActionButton
                tone="act"
                icon={X}
                label="refuse"
                reason="Refuse this call — pea continues without it"
                onClick={() => {}}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="px-2 py-1.5">
        <Textarea
          aria-label="Message"
          size="compact"
          surface="embedded"
          placeholder="Ask Pea…  ( / for skills )"
          rows={1}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <div className="flex items-center gap-1.5 pt-1">
          <Press tone="quiet" size="icon" title="Attach files">
            <Paperclip className="size-4" />
          </Press>
          <Press frame="line" tone="quiet" size="value" title="starts a new, empty thread (Alt+N)">
            new <kbd className="face-mono text-ink-mute">Alt+N</kbd>
          </Press>
          <Press frame="line" tone="quiet" size="value" title="clones this thread and opens the clone">
            fork
          </Press>
          <span className="ml-auto">
            <Press
              frame="line"
              tone="neutral"
              size="value"
              style={{ fontWeight: 600 }}
              title={text.trim() ? "send" : "Enter a prompt or attachment"}
              aria-disabled={!text.trim()}
              state={text.trim() ? "rest" : "disabled"}
            >
              send
            </Press>
          </span>
        </div>
      </div>
    </form>
  );
}

function PlanPane({ variant }: { variant: Variant }) {
  const columns = useColumns();
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<"all" | "drift" | "staged">("all");
  const rows = PARAM_ROWS.filter(
    (r) =>
      (preset === "all" || (preset === "drift" ? r.agree === "drift" : r.stage === "staged")) &&
      r.param.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Pane
      kind="inspector"
      id="plan"
      title="plan"
      meta={`${rows.length}/${PARAM_ROWS.length}`}
      help="The route body pea is working in, hosted beside the thread. Its own toolbar narrows; the table's strip narrows again."
      headerSurface={variant === "C" ? "recess" : undefined}
      toolbar={
        <>
          <Input
            aria-label="filter params"
            placeholder="filter…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            style={{ width: "10rem" }}
          />
          <Switcher
            ariaLabel="preset"
            value={preset}
            onChange={setPreset}
            options={[
              { value: "all", label: "all", title: "every row in scope" },
              { value: "drift", label: "drift", title: "rows the model disagrees with" },
              { value: "staged", label: "staged", title: "rows with unsaved edits" },
            ]}
          />
        </>
      }
      actions={
        <ActionButton
          tone="commit"
          label="apply"
          reason="fixture — no model behind this table"
          disabled
          onClick={() => {}}
        />
      }
      shortcuts={SHORTCUTS.plan}
      scroll="clip"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {rows.length ? (
          <MasterTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.key}
            scopeLabel="params in scope"
            searchPlaceholder="search params…"
            summary={<>{rows.length} params</>}
            gutter={(r) =>
              r.agree === "drift"
                ? { count: 1, title: "the model disagrees", tone: "alarm" }
                : null
            }
          />
        ) : (
          <div className="p-2">
            <EmptyState story="filter" exit="clear the filter">
              no params match
            </EmptyState>
          </div>
        )}
      </div>
    </Pane>
  );
}

const SHORTCUTS: Record<string, PaneShortcut[]> = {
  threads: [
    { hotkey: "J", label: "next thread", callback: () => {} },
    { hotkey: "K", label: "previous thread", callback: () => {} },
    { hotkey: "Alt+N", label: "new thread", says: "starts a new, empty thread", callback: () => {} },
  ],
  transcript: [
    { hotkey: "Escape", label: "jump to latest", callback: () => {} },
    { hotkey: "Mod+1", label: "threads mode", callback: () => {} },
    { hotkey: "Mod+2", label: "trace mode", callback: () => {} },
  ],
  plan: [
    { hotkey: "A", label: "approve row", refusal: "fixture — nothing to approve", callback: () => {} },
    { hotkey: "/", label: "search", callback: () => {} },
  ],
};

/* ── the lineup ──────────────────────────────────────────────────────────── */

function Lineup() {
  const s = Route.useSearch();
  const navigate = useNavigate({ from: "/prototype-root" });
  const set = (patch: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const [sideW, setSideW] = useState(288);
  const [planW, setPlanW] = useState(420);
  const rootRef = useRef<HTMLDivElement>(null);
  // narrow = the root is under 960px (provisional): the tunable width, else the window. A
  // container query cannot see its own size; production would put the query on the root's parent.
  const [winW, setWinW] = useState(() => (typeof window === "undefined" ? 1920 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const narrow = (s.width || winW) < 960;
  // Keyboard-help state: the pane whose shortcut card is showing gets data-help (prototype-only
  // observer; production would set it from Pane's own cardVisible state).
  useEffect(() => {
    const sync = () => {
      const showing = s.help > 0 || !!document.querySelector('[data-slot=pane-shortcuts][data-visible=true]');
      document.querySelectorAll('[data-proto-root] [data-slot=pane]').forEach((el) => {
        if (showing && el.getAttribute('data-active') === 'true') el.setAttribute('data-help', '');
        else el.removeAttribute('data-help');
      });
    };
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-visible', 'data-active'], childList: true });
    sync();
    return () => mo.disconnect();
  }, [s.help]);

  // ← → cycle variants unless typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,[contenteditable='true'],[role='separator'],button")) return;
      const i = VARIANTS.indexOf(s.variant);
      if (e.key === "ArrowRight") set({ variant: VARIANTS[(i + 1) % 3] });
      if (e.key === "ArrowLeft") set({ variant: VARIANTS[(i + 2) % 3] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const C = s.variant === "C";
  const sideOpen = s.side === "open" && !narrow;
  const sideCol = sideOpen ? sideW : 40;
  const frame = C ? artifactFrameRecipe().base() : "";

  // Draft retention (user verdict): one Composer per visited thread, hidden with Activity so its
  // draft state and DOM survive a thread switch without a second persistence owner.
  const [visited, setVisited] = useState<string[]>([s.thread]);
  useEffect(() => {
    if (!visited.includes(s.thread)) setVisited((v) => [...v, s.thread]);
  }, [s.thread]); // eslint-disable-line react-hooks/exhaustive-deps
  const composer = (
    <>
      {visited.map((t) => (
        <Activity key={t} mode={t === s.thread ? "visible" : "hidden"}>
          <Composer proposals={s.proposals} thread={t} set={set} />
        </Activity>
      ))}
    </>
  );

  const threadsPane = (
    <Pane
      kind="navigation"
      id="threads"
      title={sideOpen ? "threads" : undefined}
      meta={sideOpen ? `${THREADS.length}` : undefined}
      help={sideOpen ? "Recent threads; the open one is the route's selection. New here is the same verb as the composer's." : undefined}
      headerSurface={C ? "recess" : undefined}
      actions={
        sideOpen ? (
          <>
            <Switcher
              ariaLabel="View depth"
              value={s.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: "threads", label: "threads", title: "the thread list" },
                { value: "trace", label: "trace", title: "tool calls on the focal axis" },
                { value: "world", label: "world", title: "context budget and memory" },
              ]}
            />
            <Press tone="quiet" size="icon" aria-label="Collapse" onClick={() => set({ side: "rail" })}>
              <ChevronLeft />
            </Press>
          </>
        ) : undefined
      }
      shortcuts={SHORTCUTS.threads}
    >
      {sideOpen ? (
        s.mode === "threads" ? (
          <ThreadList
            threads={THREADS}
            currentThreadId={s.thread}
            onSelect={(thread) => set({ thread })}
            onNew={() => {}}
            onRename={() => {}}
            onDelete={() => {}}
            onSearch={() => {}}
          />
        ) : (
          <div className="p-2">
            <EmptyState story="scope" exit="switch back to threads">
              {s.mode} lane not mounted in the lineup
            </EmptyState>
          </div>
        )
      ) : (
        <div className="flex flex-col items-center py-2">
          <Press tone="neutral" size="icon" aria-label="Expand" onClick={() => set({ side: "open" })}>
            <ChevronRight />
          </Press>
        </div>
      )}
    </Pane>
  );

  const transcriptPane = (
    <Pane
      kind="content"
      id="transcript"
      title={THREADS.find((t) => t.id === s.thread)?.title ?? s.thread}
      meta={s.body === "ready" ? "6 turns" : s.body}
      help="The thread, oldest first. The composer is where you speak; its head says what pea is bound to."
      headerSurface={C ? "recess" : undefined}
      shortcuts={SHORTCUTS.transcript}
      scroll="clip"
    >
      {s.variant === "A" ? (
        <Transcript thread={s.thread} body={s.body} set={set} tail={<div className="shrink-0 px-3 pb-3">{composer}</div>} />
      ) : s.variant === "B" ? (
        <OverlayTranscript composer={composer} thread={s.thread} body={s.body} set={set} />
      ) : (
        <Transcript thread={s.thread} body={s.body} set={set} tail={<div className="shrink-0 on-recess px-3 py-3 hairline-t">{composer}</div>} />
      )}
    </Pane>
  );

  return (
    <div
      ref={rootRef}
      data-proto-root
      data-narrow={narrow}
      data-tone={s.tone}
      data-surface="page"
      className="fixed inset-0 grid text-ink"
      style={{
        ["--g" as string]: `${s.gutter}px`,
        ["--halo" as string]: `${s.halo}px`,
        ["--rail" as string]: `${s.rail}px`,
        padding: "var(--g)",
        gridTemplateColumns: narrow ? `${sideCol}px var(--g) minmax(0,1fr)` : `${sideCol}px var(--g) minmax(0,1fr) var(--g) ${planW}px`,
        gridTemplateRows: "minmax(0,1fr)",
        maxWidth: s.width ? `${s.width}px` : undefined,
        marginInline: s.width ? "auto" : undefined,
        outline: s.width ? "1px dashed var(--pe-line-2)" : undefined,
      }}
    >
      <style>{`
        [data-proto-root] [data-slot=pane-header]{height:var(--rail);}
        /* gutter/halo colour lineup (round 5). Three states, both treatments:
           resting gutter = page ground, no stroke;
           focused region = [data-active=true];
           keyboard help  = focused AND its shortcut card is showing ([data-help]). */
        [data-proto-root] [data-slot=pane-halo]{display:none;}
        [data-proto-root] [data-slot=pane]{transition:outline-color .12s, box-shadow .12s;}
        /* T1 fill: the gutter itself takes the selection fill (a fill, never a hue; house law 5);
           help adds one inner hairline of line-2. */
        [data-proto-root][data-tone=fill] [data-slot=pane][data-active=true]{outline:var(--halo) solid var(--pe-select) !important;outline-offset:0 !important;}
        [data-proto-root][data-tone=fill] [data-slot=pane][data-active=true][data-help]{box-shadow:inset 0 0 0 1px var(--pe-line-2);}
        /* T2 line: the gutter stays page ground; focus is one line-2 hairline standing 2px into the
           gutter; help thickens it to 2px in mute ink. */
        [data-proto-root][data-tone=line] [data-slot=pane][data-active=true]{outline:1px solid var(--pe-line-2) !important;outline-offset:2px !important;}
        [data-proto-root][data-tone=line] [data-slot=pane][data-active=true][data-help]{outline:2px solid var(--pe-ink-mute) !important;outline-offset:2px !important;}
        ${C ? "[data-proto-root] [data-slot=pane]{border:0;}" : "[data-proto-root] [data-slot=pane]{box-shadow:0 0 0 1px var(--pe-line);}"}
        [data-proto-root] [data-slot=pane-shortcuts-tab]{display:none;}
      `}</style>
      <div className={`min-h-0 min-w-0 ${frame}`}>{threadsPane}</div>
      <div className="flex items-stretch justify-center">
        {sideOpen ? (
          <PaneResizeHandle
            axis="horizontal"
            value={sideW}
            min={200}
            max={480}
            growth={1}
            containerSize={() => rootRef.current?.clientWidth}
            onResize={(px) => setSideW(px)}
            onReset={() => setSideW(288)}
          />
        ) : null}
      </div>
      <div className={`min-h-0 min-w-0 ${frame}`}>{transcriptPane}</div>
      {narrow ? null : (<>
      <div className="flex items-stretch justify-center">
        <PaneResizeHandle
          axis="horizontal"
          value={planW}
          min={280}
          max={720}
          growth={-1}
          containerSize={() => rootRef.current?.clientWidth}
          onResize={(px) => setPlanW(px)}
          onReset={() => setPlanW(420)}
        />
      </div>
      <div className={`min-h-0 min-w-0 ${frame}`}>
        <PlanPane variant={s.variant} />
      </div>
      </>)}
      <Pill s={s} set={set} />
    </div>
  );
}

/** B: the composer floats over the transcript; the transcript pads its tail by the live height. */
function OverlayTranscript({ composer, thread, body, set }: { composer: ReactNode; thread: string; body: Search["body"]; set: (p: Partial<Search>) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(96);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // Written straight to the lane as --composer-h (what chat-shell.tsx:110-119 does) and mirrored
    // into state for the scrim height; the observer fires once on observe and on every resize.
    const apply = () => {
      const px = box.offsetHeight;
      laneRef.current?.style.setProperty("--composer-h", `${px}px`);
      setH(px);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={laneRef} className="flex min-h-0 min-w-0 flex-1 flex-col [&>div>div:first-child]:pb-[calc(var(--composer-h,96px)+16px)]">
        <Transcript thread={thread} body={body} set={set} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ height: h + 48, background: "linear-gradient(to bottom, transparent, var(--pe-page) 60%)" }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3">
        <div ref={boxRef} className="pointer-events-auto">
          {composer}
        </div>
      </div>
    </div>
  );
}

/** The protoui switcher: fixed bottom-centre, visibly alien, with the tunables. */
function Pill({ s, set }: { s: Search; set: (p: Partial<Search>) => void }) {
  const i = VARIANTS.indexOf(s.variant);
  const cyc = <T,>(list: readonly T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length]!;
  const btn = (label: string, on: () => void, title: string) => (
    <button
      type="button"
      onClick={on}
      title={title}
      className="rounded-full border border-current px-2 py-0.5 hover:bg-current/10"
    >
      {label}
    </button>
  );
  return (
    <div
      role="toolbar"
      aria-label="prototype switcher"
      className="fixed top-1 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1 t-small face-mono"
      style={{ background: "#c026d3", color: "white", boxShadow: "0 2px 12px rgba(0,0,0,.4)" }}
    >
      {btn("←", () => set({ variant: VARIANTS[(i + 2) % 3] }), "previous variant (←)")}
      <span className="w-[22rem] text-center">
        {s.variant} — {LABEL[s.variant]}
      </span>
      {btn("→", () => set({ variant: VARIANTS[(i + 1) % 3] }), "next variant (→)")}
      <span className="opacity-60">|</span>
      {btn(`gutter ${s.gutter}`, () => set({ gutter: cyc([4, 6, 8, 12], s.gutter) }), "perimeter and inter-pane gutter")}
      {btn(`halo ${s.halo}`, () => set({ halo: cyc([2, 3, 6], s.halo) }), "focus halo width (lives in the gutter)")}
      {btn(`tone ${s.tone}`, () => set({ tone: s.tone === "fill" ? "line" : "fill" }), "T1 fill: gutter takes the selection fill · T2 line: one hairline in the gutter")}
      {btn(`help ${s.help}`, () => set({ help: s.help ? 0 : 1 }), "force the keyboard-help halo on the focused pane")}
      {btn(`rail ${s.rail}`, () => set({ rail: cyc([24, 28, 32], s.rail) }), "head rail height for every pane and the composer head")}
      {btn(`side ${s.side}`, () => set({ side: s.side === "open" ? "rail" : "open" }), "collapse the side lane to a rail")}
      {btn(`proposals ${s.proposals}`, () => set({ proposals: cyc([0, 1, 3], s.proposals) }), "proposals waiting under the composer head")}
      {btn(`body ${s.body}`, () => set({ body: cyc(["ready", "loading", "error", "empty"] as const, s.body) }), "the transcript pane body's state: loading is a real Suspense boundary; switching threads shows it for ~700ms")}
      {btn(`width ${s.width || "full"}`, () => set({ width: cyc([0, 1100, 760], s.width) }), "constrain the root width")}
    </div>
  );
}
