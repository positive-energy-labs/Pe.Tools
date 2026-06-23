import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkbenchContextBreakdown,
  WorkbenchState,
  WorkbenchToolCall,
} from "@pe/agent-contracts";
import { buildRows, eventIds, messageText, type Row } from "./rows.ts";
import { Markdown } from "./markdown.tsx";
import { modeDepth, type Mode } from "./depth.ts";

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
const FOCAL = 0.6; // focal line, fraction down the gutter/viewport. Lower than center: history lives above the latest turn.
const MIN_BAND = 3; // px floor so a one-line turn stays visible and clickable.
const CARD_GAP = 12; // min px between trace cards when they de-overlap.
const SHOW_ALL_LINKS = true; // ponytail: draw provenance wires for every visible card (demo default). Add a toggle if it reads noisy.

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
  const wiresRef = useRef<SVGSVGElement>(null);

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
  const eventRows = rows.filter((row) => row.events.length > 0);

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
    let geomByKey: Record<string, Geom> = {};
    let cards: { key: string; el: HTMLElement }[] = [];
    let frameTop = 0;
    let frameLeft = 0;

    const wire = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
      const dx = (x2 - x1) * 0.5;
      return `<path class="${cls}" d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}"/>`;
    };
    const hit = (x1: number, y1: number, x2: number, y2: number, key: string) => {
      const dx = (x2 - x1) * 0.5;
      return `<path class="hit" data-key="${key}" d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}"/>`;
    };
    const box = (el: HTMLElement | null) => {
      if (!el || el.offsetParent === null) return null;
      const r = el.getBoundingClientRect();
      return { L: r.left - frameLeft, R: r.right - frameLeft, Y: r.top + r.height / 2 - frameTop };
    };

    // Cards track their owning stub's center; the focal card is pinned exactly to the focal
    // axis (the hard requirement) and the rest de-overlap around it.
    const positionPinned = (s: number, V: number, fk: string | null) => {
      const fy = FOCAL * V;
      const vis: { key: string; el: HTMLElement; center: number; h: number; top: number }[] = [];
      for (const c of cards) {
        const g = geomByKey[c.key];
        const center = g ? g.top + g.height / 2 - s : Number.NaN;
        if (!g || center < -80 || center > V + 80) {
          c.el.style.display = "none";
          continue;
        }
        c.el.style.display = "";
        vis.push({ key: c.key, el: c.el, center, h: 0, top: 0 });
      }
      vis.sort((a, b) => a.center - b.center);
      for (const c of vis) {
        c.h = c.el.offsetHeight;
        c.top = c.center - c.h / 2;
      }
      for (let i = 1; i < vis.length; i++) {
        const prev = vis[i - 1];
        vis[i].top = Math.max(vis[i].top, prev.top + prev.h + CARD_GAP);
      }
      const f = vis.find((c) => c.key === fk);
      if (f) {
        const delta = fy - f.h / 2 - f.top;
        for (const c of vis) c.top += delta;
      }
      for (const c of vis) c.el.style.top = `${c.top}px`;
      // ponytail: a dense cluster near the focal card can still slide a neighbour off its
      // exact stub-y; the focal card itself stays pinned.
    };

    const drawWires = (fy: number, fk: string | null) => {
      const wires = wiresRef.current;
      if (!wires) return;
      let p = "";
      const hoverKey = hoverKeyRef.current;
      for (const c of cards) {
        if (c.key === fk) continue;
        const draw = SHOW_ALL_LINKS || c.key === hoverKey;
        if (!draw) continue;
        const stub = box(momentRefs.current.get(c.key) ?? null);
        const card = box(c.el);
        if (!stub || !card) continue;
        const cls = c.key === hoverKey ? "hover" : "w";
        p += wire(stub.R, stub.Y, card.L, card.Y, cls);
        if (SHOW_ALL_LINKS) p += hit(stub.R, stub.Y, card.L, card.Y, c.key);
      }
      // the focal funnel: band -> stub (-> card, if the focal stub has one). Bright.
      const band = fk ? box(bandRefs.current.get(fk) ?? null) : null;
      const stub = fk ? box(momentRefs.current.get(fk) ?? null) : null;
      const focalCard = cards.find((c) => c.key === fk);
      const card = focalCard ? box(focalCard.el) : null;
      if (band && stub) {
        p += wire(band.R, band.Y, stub.L, fy, "f");
        p += `<circle cx="${stub.L}" cy="${fy}" r="2.5"/>`;
      }
      if (stub && card) p += wire(stub.R, fy, card.L, card.Y, "f");
      wires.innerHTML = p;
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

      positionPinned(s, V, fk);
      for (const c of cards) {
        c.el.classList.toggle("focal", c.key === fk);
        c.el.classList.toggle("hover", c.key === hoverKey && c.key !== fk);
      }

      drawWires(fy, fk);
    };

    const measure = () => {
      geom = chatRows.flatMap((row) => {
        const el = momentRefs.current.get(row.key);
        return el ? [{ key: row.key, top: el.offsetTop, height: el.offsetHeight }] : [];
      });
      geomByKey = Object.fromEntries(geom.map((g) => [g.key, g]));
      geomRef.current = geom;
      cards = detailRows.flatMap((row) => {
        const el = cardRefs.current.get(row.key);
        return el ? [{ key: row.key, el }] : [];
      });
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        band.style.top = `${g.top * SCALE}px`;
        band.style.height = `${Math.max(MIN_BAND, g.height * SCALE)}px`;
      }
      const fr = frame.getBoundingClientRect();
      frameTop = fr.top;
      frameLeft = fr.left;
      const wires = wiresRef.current;
      if (wires) {
        wires.setAttribute("viewBox", `0 0 ${fr.width} ${fr.height}`);
        wires.setAttribute("width", `${fr.width}`);
        wires.setAttribute("height", `${fr.height}`);
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

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    const onScroll = () => schedule();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    const chat = chatRef.current;
    const trace = traceInnerRef.current;
    const wires = wiresRef.current;
    const onChatOver = (e: Event) => setHover(keyFrom(e, ".lens-moment"));
    const onChatLeave = () => setHover(null);
    const onTraceOver = (e: Event) => setHover(keyFrom(e, ".lens-cell"));
    const onWiresOver = (e: Event) => setHover(keyFrom(e, ".hit"));
    const onWiresOut = (e: Event) => {
      if ((e.target as HTMLElement).closest(".hit")) setHover(null);
    };
    chat?.addEventListener("mouseover", onChatOver);
    chat?.addEventListener("mouseleave", onChatLeave);
    trace?.addEventListener("mouseover", onTraceOver);
    trace?.addEventListener("mouseleave", onChatLeave);
    wires?.addEventListener("mouseover", onWiresOver);
    wires?.addEventListener("mouseout", onWiresOut);

    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      chat?.removeEventListener("mouseover", onChatOver);
      chat?.removeEventListener("mouseleave", onChatLeave);
      trace?.removeEventListener("mouseover", onTraceOver);
      trace?.removeEventListener("mouseleave", onChatLeave);
      wires?.removeEventListener("mouseover", onWiresOver);
      wires?.removeEventListener("mouseout", onWiresOut);
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
                    <div
                      key={row.key}
                      data-key={row.key}
                      className="lens-cell"
                      ref={(el) => {
                        if (el) cardRefs.current.set(row.key, el);
                        else cardRefs.current.delete(row.key);
                      }}
                    >
                      <TraceCell row={row} />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {mode === "strata" ? (
              <div className="lens-lane strata">
                <div className="lens-inner">
                  {eventRows.map((row) => (
                    <StrataGroup key={row.key} row={row} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {rows.length > 0 ? <svg className="lens-wires" ref={wiresRef} aria-hidden="true" /> : null}
      {rows.length > 0 ? <div className="lens-scrim" aria-hidden="true" /> : null}
    </div>
  );
}

function ChatSpine({ row, streaming }: { row: Row; streaming: boolean }) {
  switch (row.kind) {
    case "user":
      return (
        <>
          <div className="lens-who you">you</div>
          <div className="lens-bubble">{messageText(row.message)}</div>
        </>
      );
    case "assistant":
      return (
        <>
          <div className="lens-who pea">pea</div>
          <div className="mg-prose" style={{ display: "grid", gap: "8px" }}>
            {row.message?.parts.map((part, index) => {
              if (part.kind === "text") return <Markdown key={index} text={part.text} />;
              if (part.kind === "reasoning" || part.kind === "thought")
                return (
                  <div
                    key={index}
                    style={{
                      borderLeft: "2px solid var(--kiln)",
                      paddingLeft: "10px",
                      color: "var(--lichen)",
                      fontSize: "13px",
                    }}
                  >
                    {part.text}
                  </div>
                );
              return null;
            })}
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
      return (
        <div className="lens-marker active">
          <span className="lens-mtag" style={{ color: "var(--clay-ink)" }}>
            APPROVAL
          </span>
          <span style={{ fontSize: "13px" }}>{row.approval?.toolCall.title}</span>
        </div>
      );
    default:
      return null;
  }
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

function TraceCell({ row }: { row: Row }) {
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

function StrataGroup({ row }: { row: Row }) {
  const shown = row.events.slice(0, 4);
  return (
    <div>
      {shown.map((event) => (
        <div className="lens-ev" key={event.id} title={event.type}>
          <b>#{eventIds(event).sequence ?? "—"}</b> {event.type}
        </div>
      ))}
      {row.events.length > shown.length ? (
        <div className="lens-ev" style={{ color: "var(--kiln)" }}>
          +{row.events.length - shown.length}
        </div>
      ) : null}
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
