import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkbenchApprovalRequest,
  WorkbenchContextBreakdown,
  WorkbenchDebugEvent,
  WorkbenchMessagePart,
  WorkbenchState,
  WorkbenchToolCall,
} from "@pe/agent-contracts";
import { Check, ChevronRight, GitFork, X } from "lucide-react";
import { buildRows, eventIds, messageText, type Row } from "./rows.ts";
import { Markdown } from "./markdown.tsx";
import { modeDepth, type Mode } from "./depth.ts";
import { useWorkbench } from "./WorkbenchProvider.tsx";

/**
 * The unified workbench view (one layout, one scroll). Modes don't swap UIs — they toggle
 * panes: `chat` shows chat + MapDial; `trace` adds the detail lane; `strata` adds the
 * events lane. The MapDial gutter, candlestick focal marker, and the funnel wires are
 * always present.
 *
 * Ported 1:1 from `mapdial-demo.html` (the proven reference): a candlestick focal marker
 * (horizontal focal bar + viewport wick), proportional map bands that scroll under it at a
 * fixed SCALE, trace cards pinned to their chat stub's y (focal card pinned exactly to the
 * focal axis, the rest de-overlap around it), and bezier wires funneling band → stub → card.
 * One rAF scroll controller drives all three columns + the wires overlay — they share
 * geometry, so it cannot be cleanly split across components (the old separate MapDial.tsx
 * was folded in here).
 */

const SCALE = 0.14; // chat px -> map px. Fixed, NOT fit-to-container: long threads overflow, short leave the gutter empty.
const FOCAL = 0.5; // focal line, fraction down the gutter/viewport.
const MIN_BAND = 3; // px floor so a one-line turn stays visible and clickable.

interface Geom {
  key: string;
  top: number;
  height: number;
}

export function Lens({ state, mode }: { state: WorkbenchState; mode: Mode }) {
  const rows = buildRows(state, "strata");
  const runStatus = state.uiStatus.overall.status;
  const isRunning = runStatus === "running" || runStatus === "starting";

  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const traceInnerRef = useRef<HTMLDivElement>(null);

  // gutter / candlestick
  const stripRef = useRef<HTMLDivElement>(null);
  const wickRef = useRef<HTMLDivElement>(null);
  const capTopRef = useRef<HTMLDivElement>(null);
  const capBotRef = useRef<HTMLDivElement>(null);
  const csFocalRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);

  const momentRefs = useRef(new Map<string, HTMLElement>());
  const bandRefs = useRef(new Map<string, HTMLElement>());
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const geomRef = useRef<Geom[]>([]);
  const hoverKeyRef = useRef<string | null>(null);

  // The --vp aperture height feeds the sticky gutter/lane heights. Kept as its own effect so
  // it fires from first paint even on the empty-state tree.
  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollerRef.current;
    if (!frame || !scroller) return;
    const apply = () => frame.style.setProperty("--vp", `${scroller.clientHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const count = rows.length;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [count]);

  const chatRows = rows.filter((row) => row.kind !== "event");
  const streamingKey = isRunning
    ? [...chatRows].reverse().find((row) => row.kind === "assistant")?.key
    : undefined;
  const detailRows = rows.filter((row) => row.kind === "tool" || row.kind === "memory");

  // drag the gutter to scrub (gutter motion ÷ SCALE = chat motion); a tap centers the band.
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const startY = event.clientY;
    const startScroll = scroller.scrollTop;
    const bandKey = (event.target as HTMLElement).closest<HTMLElement>(".mapdial-band")?.dataset
      .key;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 3) dragged = true;
      if (dragged) scroller.scrollTop = startScroll + (ev.clientY - startY) / SCALE;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragged && bandKey) {
        const g = geomRef.current.find((geom) => geom.key === bandKey);
        if (g)
          scroller.scrollTo({ top: g.top - FOCAL * scroller.clientHeight, behavior: "smooth" });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  // The single scroll controller: candlestick + bands + chat stubs + pinned cards + wires.
  // Mutates refs only (no per-frame React render). Re-measures on resize and on row changes.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const frame = frameRef.current;
    const strip = stripRef.current;
    if (!scroller || !frame || !strip) return;

    const detailKeys = new Set(detailRows.map((row) => row.key));
    let geom: Geom[] = [];
    let cards: { key: string; el: HTMLElement }[] = [];

    // Fisheye: non-focal cards collapse to their header strip; focal expands. The lane
    // translates so the expanded card's center sits on the focal axis. A short rAF pump
    // re-measures live during the max-height CSS transition so translation tracks smoothly.
    let fisheyeAi = -1;
    let fisheyeRaf = 0;
    const positionFisheye = (s: number, V: number, fk: string | null) => {
      const fy = FOCAL * V;
      const hoverKey = hoverKeyRef.current;
      let focalCell: HTMLElement | null = null;
      let newAi = -1;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const on = c.key === fk;
        c.el.style.maxHeight = on ? "400px" : "28px";
        c.el.classList.toggle("focal", on);
        c.el.classList.toggle("hover", c.key === hoverKey && !on);
        if (on) { focalCell = c.el; newAi = i; }
      }
      const inner = traceInnerRef.current;
      const doLayout = () => {
        if (!inner) return;
        const center = focalCell ? focalCell.offsetTop + focalCell.offsetHeight / 2 : 0;
        inner.style.transform = `translateY(${fy - center}px)`;
      };
      doLayout();
      if (newAi !== fisheyeAi) {
        fisheyeAi = newAi;
        cancelAnimationFrame(fisheyeRaf);
        const end = performance.now() + 300;
        const pump = () => { doLayout(); fisheyeRaf = performance.now() < end ? requestAnimationFrame(pump) : 0; };
        fisheyeRaf = requestAnimationFrame(pump);
      }
    };

    const sync = () => {
      const s = scroller.scrollTop;
      const V = scroller.clientHeight;
      const focalG = FOCAL * V;
      const fy = FOCAL * V;

      // candlestick: horizontal focal bar + vertical wick (the viewport extent)
      const wickTop = focalG - SCALE * FOCAL * V;
      const wickH = SCALE * V;
      if (wickRef.current) {
        wickRef.current.style.top = `${wickTop}px`;
        wickRef.current.style.height = `${wickH}px`;
      }
      if (capTopRef.current) capTopRef.current.style.top = `${wickTop}px`;
      if (capBotRef.current) capBotRef.current.style.top = `${wickTop + wickH}px`;
      if (csFocalRef.current) csFocalRef.current.style.top = `${fy}px`;
      if (caretRef.current) caretRef.current.style.top = `${fy}px`;

      strip.style.transform = `translateY(${focalG - SCALE * (s + FOCAL * V)}px)`;

      // which stub sits on the focal axis?
      const focalDoc = s + FOCAL * V;
      let fk: string | null = null;
      for (const g of geom) {
        if (g.top <= focalDoc && focalDoc < g.top + g.height) {
          fk = g.key;
          break;
        }
        if (g.top <= focalDoc) fk = g.key;
      }

      const hoverKey = hoverKeyRef.current;
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (band) {
          const on = g.top + g.height > s && g.top < s + V;
          band.classList.toggle("in-reticle", on);
          band.classList.toggle("focal", g.key === fk);
        }
        const moment = momentRefs.current.get(g.key);
        if (moment) {
          moment.classList.toggle("focal", g.key === fk);
          moment.classList.toggle("hover", g.key === hoverKey);
        }
      }

      positionFisheye(s, V, fk);
    };

    const measure = () => {
      geom = chatRows.flatMap((row) => {
        const el = momentRefs.current.get(row.key);
        return el ? [{ key: row.key, top: el.offsetTop, height: el.offsetHeight }] : [];
      });
      geomRef.current = geom;
      cards = detailRows.flatMap((row) => {
        const el = cardRefs.current.get(row.key);
        return el ? [{ key: row.key, el }] : [];
      });
      // Re-flow the de-overlap whenever a card's height changes (e.g. expand-in-place).
      cardRo.disconnect();
      for (const card of cards) cardRo.observe(card.el);
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        band.style.top = `${g.top * SCALE}px`;
        band.style.height = `${Math.max(MIN_BAND, g.height * SCALE)}px`;
      }
      sync();
    };

    const setHover = (key: string | null | undefined) => {
      const next = key && detailKeys.has(key) ? key : null;
      if (next === hoverKeyRef.current) return;
      hoverKeyRef.current = next;
      schedule();
    };
    const keyFrom = (event: Event, selector: string) =>
      (event.target as HTMLElement).closest<HTMLElement>(selector)?.dataset.key;

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    const cardRo = new ResizeObserver(() => schedule());

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    const onScroll = () => schedule();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    const chat = chatRef.current;
    const trace = traceInnerRef.current;
    const onChatOver = (e: Event) => setHover(keyFrom(e, ".lens-moment"));
    const onChatLeave = () => setHover(null);
    const onTraceOver = (e: Event) => setHover(keyFrom(e, ".lens-cell"));
    chat?.addEventListener("mouseover", onChatOver);
    chat?.addEventListener("mouseleave", onChatLeave);
    trace?.addEventListener("mouseover", onTraceOver);
    trace?.addEventListener("mouseleave", onChatLeave);

    return () => {
      ro.disconnect();
      cardRo.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(fisheyeRaf);
      chat?.removeEventListener("mouseover", onChatOver);
      chat?.removeEventListener("mouseleave", onChatLeave);
      trace?.removeEventListener("mouseover", onTraceOver);
      trace?.removeEventListener("mouseleave", onChatLeave);
    };
    // chatRows/detailRows are fresh arrays each render; re-running re-measures geometry as the
    // thread (and streaming text heights) change. Hover survives via hoverKeyRef.
  }, [rows, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // The scroller must always mount so the --vp ResizeObserver fires (it feeds the sticky
  // gutter/lane heights). Bailing to a different tree when empty left --vp unset, so on the
  // first populated render the lanes/MapDial fell back to 560px and got cut off.
  return (
    <div className="lens-frame" ref={frameRef} data-mode={mode}>
      <div className="lens-scroller" ref={scrollerRef}>
        {rows.length === 0 ? (
          <div className="mg-empty">
            <h1>Pea</h1>
            <p>Ask anything to begin. Use the dial to reveal what's happening underneath.</p>
          </div>
        ) : (
          <div className="lens-grid">
            <div className="mapdial" onPointerDown={onPointerDown} aria-label="Timeline">
              <div className="mapdial-strip" ref={stripRef}>
                {chatRows.map((row, index) => (
                  <div
                    key={row.key}
                    data-key={row.key}
                    className={`mapdial-band ${row.kind}`}
                    ref={(el) => {
                      if (el) bandRefs.current.set(row.key, el);
                      else bandRefs.current.delete(row.key);
                    }}
                  >
                    <span className="num">{bandNumber(row, index)}</span>
                  </div>
                ))}
              </div>
              <div className="cs-wick" ref={wickRef} />
              <div className="cs-cap" ref={capTopRef} />
              <div className="cs-cap" ref={capBotRef} />
              <div className="cs-focal" ref={csFocalRef} />
              <div className="caret" ref={caretRef} />
            </div>

            <div className="lens-chat" ref={chatRef}>
              <ContextStrip state={state} depth={modeDepth(mode)} />
              {chatRows.map((row) => (
                <section
                  key={row.key}
                  data-key={row.key}
                  className="lens-moment"
                  ref={(el) => {
                    if (el) momentRefs.current.set(row.key, el);
                    else momentRefs.current.delete(row.key);
                  }}
                >
                  <ChatSpine row={row} streaming={row.key === streamingKey} />
                </section>
              ))}
            </div>

            {mode !== "chat" ? (
              <div className="lens-lane trace">
                <div className="lens-pin" ref={traceInnerRef}>
                  {detailRows.map((row) => (
                    <TraceCell
                      key={row.key}
                      row={row}
                      registerRef={(el) => {
                        if (el) cardRefs.current.set(row.key, el);
                        else cardRefs.current.delete(row.key);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {mode === "strata" ? (
              <div className="lens-lane strata">
                <DevtoolsLane events={state.debug.events} />
              </div>
            ) : null}
          </div>
        )}
      </div>
      {rows.length > 0 ? <div className="lens-scrim" aria-hidden="true" /> : null}
    </div>
  );
}

function ChatSpine({ row, streaming }: { row: Row; streaming: boolean }) {
  switch (row.kind) {
    case "user":
      return <UserTurn text={messageText(row.message)} />;
    case "assistant":
      return (
        <>
          <div className="lens-who pea">pea</div>
          <div className="mg-prose" style={{ display: "grid", gap: "8px" }}>
            {(row.message?.parts ?? []).map((part, index) => (
              <AssistantPart key={index} part={part} />
            ))}
            {streaming ? <span className="mg-caret" aria-hidden="true" /> : null}
          </div>
        </>
      );
    case "tool": {
      const call = row.toolCall;
      if (!call) return null;
      const tone =
        call.status === "failed" ? "failed" : call.status === "completed" ? "" : "active";
      const target = toolTarget(call);
      return (
        <div className={`lens-marker tool ${tone}`}>
          <span>⌗ {call.title}</span>
          {target ? <code>{target}</code> : null}
        </div>
      );
    }
    case "memory":
      return (
        <div className="lens-marker memory">
          <span className="lens-mtag">
            {row.memory?.kind === "reflection" ? "REFLECTION" : "MEMORY"}
          </span>
          <span style={{ fontSize: "13px", color: "var(--lichen)" }}>
            {row.memory?.summary ?? row.memory?.title ?? row.memory?.kind}
          </span>
        </div>
      );
    case "approval":
      return row.approval ? <ApprovalCard approval={row.approval} /> : null;
    default:
      return null;
  }
}

function UserTurn({ text }: { text: string }) {
  const { forkThread } = useWorkbench();
  return (
    <>
      <div className="lens-who you">
        <span>you</span>
        <button
          className="lens-fork"
          type="button"
          title="Fork this conversation into a new thread"
          onClick={() => void forkThread()}
        >
          <GitFork size={12} />
        </button>
      </div>
      <div className="lens-bubble">{text}</div>
    </>
  );
}

function AssistantPart({ part }: { part: WorkbenchMessagePart }) {
  if (part.kind === "text") return <Markdown text={part.text} />;
  if (part.kind === "reasoning" || part.kind === "thought") return <Thinking text={part.text} />;
  return null;
}

/** Collapsible chain-of-thought block (collapsed by default; the spine stays calm). */
function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className={`lens-cot ${open ? "open" : ""}`}>
      <button className="lens-cot-head" type="button" onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={12} className="lens-cot-caret" />
        <span>Thought process</span>
      </button>
      {open ? <div className="lens-cot-body">{text}</div> : null}
    </div>
  );
}

function ApprovalCard({ approval }: { approval: WorkbenchApprovalRequest }) {
  const { resolveApproval } = useWorkbench();
  const target = toolTarget(approval.toolCall);
  return (
    <div className="lens-approval">
      <div className="lens-approval-head">
        <span className="lens-mtag approval">APPROVAL</span>
        <span className="lens-approval-title">{approval.toolCall.title}</span>
      </div>
      {target ? <code className="lens-approval-target">{target}</code> : null}
      <div className="lens-approval-actions">
        {approval.options.map((option) => {
          const allow = option.kind.startsWith("allow");
          return (
            <button
              key={option.optionId}
              type="button"
              className={`lens-approval-btn ${allow ? "allow" : "deny"}`}
              onClick={() => void resolveApproval(approval.requestId, option.optionId)}
            >
              {allow ? <Check size={13} /> : <X size={13} />}
              {option.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ContextStrip({
  state,
  depth,
}: {
  state: WorkbenchState;
  depth: "read" | "trace" | "strata";
}) {
  const [open, setOpen] = useState(false);
  const plan = state.plans.entries;
  const systemPrompt = state.inspector.systemPrompt;
  const breakdown = state.inspector.contextBreakdown;
  const showContext = depth !== "read";

  if (
    plan.length === 0 &&
    !breakdown &&
    !(showContext && (systemPrompt || state.inspector.contextEntries.length))
  ) {
    return null;
  }

  return (
    <div className="mg-context">
      {breakdown ? <ContextMeter breakdown={breakdown} /> : null}

      {plan.length > 0 ? (
        <div className="mg-block">
          <div className="mg-block-head">Plan</div>
          {plan.map((entry) => (
            <div
              className={`mg-plan-item ${entry.status === "completed" ? "done" : entry.status}`}
              key={entry.id}
            >
              <span
                className={`mg-plan-mark ${entry.status === "completed" ? "done" : entry.status}`}
              >
                {entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "▸" : "○"}
              </span>
              <span>{entry.content}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showContext && systemPrompt ? (
        <div className="mg-block">
          <button
            className="mg-block-head"
            type="button"
            style={{ width: "100%", border: "none", cursor: "pointer" }}
            onClick={() => setOpen((value) => !value)}
          >
            <span>System prompt{systemPrompt.source ? ` · ${systemPrompt.source}` : ""}</span>
            <span style={{ color: "var(--pe-blue)" }}>{open ? "hide" : "show"}</span>
          </button>
          {open ? <pre className="mg-pre">{systemPrompt.content}</pre> : null}
        </div>
      ) : null}

      {showContext && state.inspector.contextEntries.length > 0 ? (
        <div className="mg-block">
          <div className="mg-block-head">Context injected</div>
          {state.inspector.contextEntries.map((entry) => (
            <div className="mg-plan-item" key={entry.id} style={{ color: "var(--slate)" }}>
              <span className="mg-tag ctx">CTX</span>
              <span>{entry.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const SEGMENT_TONES: Record<string, string> = {
  messages: "var(--pe-blue)",
  "system-prompt": "var(--pe-green)",
  tools: "var(--clay-ink, #b07a4f)",
  memory: "var(--clay, #c89b6a)",
  free: "var(--mist, #d8dde2)",
};

/**
 * The context-window token meter — a thin projection of `inspector.contextBreakdown`.
 * One stacked bar over the whole window, then a labelled row per segment with its token
 * count, share, and (collapsible) named contents.
 */
function ContextMeter({ breakdown }: { breakdown: WorkbenchContextBreakdown }) {
  const [open, setOpen] = useState(true);
  const window = breakdown.contextWindow;
  const denom = window && window > 0 ? window : Math.max(breakdown.totalTokens, 1);
  const pct = (tokens: number) => (tokens / denom) * 100;
  const usedPct = window ? Math.round((breakdown.totalTokens / window) * 100) : undefined;
  const tone = (id: string) => SEGMENT_TONES[id] ?? "var(--slate, #8a9199)";

  return (
    <div className="mg-block mg-meter">
      <button
        className="mg-block-head"
        type="button"
        style={{ width: "100%", border: "none", cursor: "pointer" }}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          Context window
          {window ? (
            <span className="mg-meter-sum">
              {" · "}
              {fmt(breakdown.totalTokens)} / {fmt(window)}
              {usedPct !== undefined ? ` (${usedPct}%)` : ""}
            </span>
          ) : (
            <span className="mg-meter-sum"> · {fmt(breakdown.totalTokens)} tok</span>
          )}
        </span>
        <span style={{ color: "var(--pe-blue)" }}>{open ? "hide" : "show"}</span>
      </button>

      <div className="mg-meter-bar" role="img" aria-label="Context window usage">
        {breakdown.segments.map((segment) => (
          <span
            key={segment.id}
            className="mg-meter-fill"
            title={`${segment.label} · ${fmt(segment.tokens)} tok`}
            style={{ width: `${pct(segment.tokens)}%`, background: tone(segment.id) }}
          />
        ))}
      </div>

      {open ? (
        <div className="mg-meter-rows">
          {breakdown.segments.map((segment) => (
            <div className="mg-meter-row" key={segment.id}>
              <span className="mg-meter-dot" style={{ background: tone(segment.id) }} />
              <span className="mg-meter-label">{segment.label}</span>
              <span className="mg-meter-tokens">{fmt(segment.tokens)}</span>
              <span className="mg-meter-pct">{pct(segment.tokens).toFixed(1)}%</span>
              {segment.items && segment.items.length > 0 ? (
                <ul className="mg-meter-items">
                  {segment.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function fmt(tokens: number): string {
  return Math.round(tokens).toLocaleString();
}

function TraceCell({
  row,
  registerRef,
}: {
  row: Row;
  registerRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div data-key={row.key} className="lens-cell" ref={registerRef}>
      <TraceCellBody row={row} />
    </div>
  );
}

function TraceCellBody({ row }: { row: Row }) {
  if (row.kind === "tool" && row.toolCall) {
    const call = row.toolCall;
    const output = call.rawOutput ?? call.content;
    return (
      <>
        <div className="h">{call.title}</div>
        {call.rawInput !== undefined ? <pre>{stringify(call.rawInput)}</pre> : null}
        {output !== undefined ? <pre>{stringify(output)}</pre> : null}
        {call.error ? <pre>{call.error}</pre> : null}
      </>
    );
  }
  if (row.kind === "memory" && row.memory) {
    const entry = row.memory;
    return (
      <>
        <div className="h">
          {entry.kind} · {entry.status}
        </div>
        <pre>{stringify(entry.raw ?? entry.summary ?? entry.title ?? entry.id)}</pre>
      </>
    );
  }
  return null;
}

/**
 * The strata gutter is a live DevTools panel over the canonical RuntimeEvent stream —
 * sequence-numbered, typed, source-tagged, click-to-expand payloads. Pins to the viewport
 * and scrolls itself (events are a flat stream, so they don't align to chat rows).
 */
function DevtoolsLane({ events }: { events: WorkbenchDebugEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  const onScroll = () => {
    const el = ref.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return (
    <div className="lens-devtools" ref={ref} onScroll={onScroll}>
      <div className="lens-devtools-head">
        runtime events <span>{events.length}</span>
      </div>
      {events.length === 0 ? (
        <p className="lens-devtools-empty">No events yet. Send a message to watch the stream.</p>
      ) : (
        events.map((event) => <DevtoolsEvent key={event.id} event={event} />)
      )}
    </div>
  );
}

function DevtoolsEvent({ event }: { event: WorkbenchDebugEvent }) {
  const [open, setOpen] = useState(false);
  const sequence = eventIds(event).sequence;
  const hasPayload = event.payload !== undefined && event.payload !== null;
  return (
    <div className={`lens-ev ${open ? "open" : ""}`}>
      <button
        type="button"
        className="lens-ev-head"
        onClick={() => hasPayload && setOpen((value) => !value)}
      >
        <span className="seq">{sequence ?? "—"}</span>
        <span className="type">{event.type}</span>
        <span className="src">{event.source}</span>
      </button>
      {open && hasPayload ? <pre className="lens-ev-body">{stringify(event.payload)}</pre> : null}
    </div>
  );
}

function bandNumber(row: Row, index: number): string {
  const time = formatTime(row.message?.createdAt);
  return time ?? `#${index + 1}`;
}

function formatTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toolTarget(call: WorkbenchToolCall): string | undefined {
  const location = call.locations?.[0]?.path;
  if (location) return location;
  const input = call.rawInput;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const candidate = record.path ?? record.file ?? record.query ?? record.command;
    if (typeof candidate === "string") return candidate;
  }
  if (typeof input === "string" && input.length <= 64) return input;
  return undefined;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}
