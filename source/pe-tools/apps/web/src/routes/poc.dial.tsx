import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";

export const Route = createFileRoute("/poc/dial")({ component: PocDial });

/* ------------------------------------------------------------------------------------------------
 * POC: two independent judgements on one page.
 *   SECTION 1 — "MapDial diet": three width/treatment variants of the position instrument.
 *   SECTION 2 — "Color budget": one dashboard panel at three color intensities.
 * Self-contained. No workbench imports; the MapDial markup is REPLICATED here (not imported from
 * Lens) so the geometry can be driven by a local scripted/scrubbable scroll position. Mock data only.
 * ---------------------------------------------------------------------------------------------- */

// ── shared mock thread ──────────────────────────────────────────────────────────────────────────
type Role = "user" | "pea";
const TURNS: Role[] = [
  "user",
  "pea",
  "pea",
  "user",
  "pea",
  "user",
  "pea",
  "pea",
  "pea",
  "user",
  "pea",
  "user",
  "pea",
  "pea",
  "user",
  "pea",
];
const N = TURNS.length;
const DIAL_H = 460; // px — the sticky instrument height
const WINDOW = 0.2; // fraction of the thread the viewport aperture covers

function bandColor(role: Role, focal: boolean): string {
  if (focal) return "var(--pe-blue)"; // focal turn → full PE Blue
  return role === "user" ? "var(--user-line)" : "var(--pea-line)"; // provenance
}

// The current viewport window + focal turn, derived from a 0..1 scroll position.
function derive(scroll: number) {
  const rTop = scroll * (1 - WINDOW);
  const rBot = rTop + WINDOW;
  const center = (rTop + rBot) / 2;
  const focal = Math.min(N - 1, Math.max(0, Math.floor(center * N)));
  return { rTop, rBot, focal };
}

// ── one dial, three treatments ────────────────────────────────────────────────────────────────
type Variant = "ref" | "slim" | "ultra";

function Dial({ variant, scroll }: { variant: Variant; scroll: number }) {
  const { rTop, rBot, focal } = derive(scroll);

  const width = variant === "ref" ? 104 : variant === "slim" ? 64 : 44;
  const cx = width / 2; // center x for wicks/readouts

  return (
    <div
      className={`poc-dial poc-dial-${variant} relative overflow-hidden select-none`}
      style={{
        width,
        height: DIAL_H,
        borderLeft: "0.5px solid var(--line)",
        background: "var(--paper-3)",
      }}
      aria-label={`MapDial ${variant}`}
    >
      {/* segments — one per turn, positioned proportionally */}
      {TURNS.map((role, i) => {
        const c = (i + 0.5) / N;
        const inReticle = c >= rTop && c <= rBot;
        const isFocal = i === focal;
        const color = bandColor(role, isFocal);
        const top = (i / N) * DIAL_H;
        const h = DIAL_H / N;

        if (variant === "ref") {
          // 104px reference — 14px rounded bars, focal fattens + haloes + shows its number.
          const w = isFocal ? 24 : 14;
          const hollow = role === "pea" && !isFocal; // pea = hollow green rail (provenance)
          return (
            <div
              key={i}
              className="band absolute"
              style={{
                top: top + 1,
                height: h - 2,
                right: isFocal ? 12 : 16,
                width: w,
                borderRadius: 2,
                background: hollow ? "transparent" : color,
                boxShadow: isFocal
                  ? "0 0 0 2px var(--paper-3), 0 0 0 3px color-mix(in srgb, var(--pe-blue) 35%, transparent)"
                  : hollow
                    ? "inset 0 0 0 1.25px var(--pea-line)"
                    : "none",
                opacity: isFocal ? 1 : inReticle ? 0.85 : 0.4,
                transition: "right .14s ease, width .14s ease, opacity .14s ease",
              }}
            >
              {isFocal && (
                <span
                  className="absolute font-[var(--font-pe-mono)]"
                  style={{
                    right: 30,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 9,
                    color: "var(--pe-blue)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {i + 1}
                </span>
              )}
            </div>
          );
        }

        if (variant === "slim") {
          // 64px — thinner 8px bars, HARD SQUARE (no radius), number on hover only.
          return (
            <div
              key={i}
              className="band absolute"
              style={{
                top: top + 1.5,
                height: h - 3,
                right: 14,
                width: 8,
                borderRadius: 0,
                background: color,
                opacity: isFocal ? 1 : inReticle ? 0.85 : 0.38,
                transition: "opacity .14s ease",
              }}
            >
              <span
                className="num absolute font-[var(--font-pe-mono)]"
                style={{
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 10,
                  color: isFocal ? "var(--pe-blue)" : "var(--muted-foreground)",
                  whiteSpace: "nowrap",
                }}
              >
                {i + 1}
              </span>
            </div>
          );
        }

        // ultra 44px — segments as 2px full-width ticks; focal tick goes full PE Blue.
        return (
          <div
            key={i}
            className="band absolute"
            style={{
              top: ((i + 0.5) / N) * DIAL_H - 1,
              height: isFocal ? 3 : 2,
              right: 6,
              left: 8,
              background: color,
              opacity: isFocal ? 1 : inReticle ? 0.9 : 0.42,
              transition: "opacity .14s ease",
            }}
          />
        );
      })}

      {/* viewport reticle — one treatment per variant */}
      {variant === "ref" && (
        <>
          {/* candlestick: focal bar at aperture center + vertical wick spanning the window + caps */}
          <div
            className="absolute left-0 right-0"
            style={{
              top: ((rTop + rBot) / 2) * DIAL_H,
              borderTop: "1.5px solid color-mix(in srgb, var(--pe-blue) 60%, transparent)",
              pointerEvents: "none",
            }}
          />
          <div
            className="absolute"
            style={{
              left: cx,
              top: rTop * DIAL_H,
              height: (rBot - rTop) * DIAL_H,
              borderLeft: "1px solid color-mix(in srgb, var(--pe-blue) 32%, transparent)",
            }}
          />
          {[rTop, rBot].map((f, k) => (
            <div
              key={k}
              className="absolute"
              style={{
                left: cx - 8,
                width: 16,
                top: f * DIAL_H,
                borderTop: "1px solid color-mix(in srgb, var(--pe-blue) 32%, transparent)",
              }}
            />
          ))}
        </>
      )}

      {variant === "slim" && (
        // hard square reticle box around the aperture
        <div
          className="absolute pointer-events-none"
          style={{
            left: 4,
            right: 4,
            top: rTop * DIAL_H,
            height: (rBot - rTop) * DIAL_H,
            border: "1px solid color-mix(in srgb, var(--pe-blue) 70%, transparent)",
            borderRadius: 0,
          }}
        />
      )}

      {variant === "ultra" && (
        <>
          {/* bracket marks at the aperture top + bottom */}
          {[rTop, rBot].map((f, k) => {
            const isTop = k === 0;
            return (
              <div
                key={k}
                className="absolute pointer-events-none"
                style={{ left: 3, right: 3, top: f * DIAL_H }}
              >
                <span
                  className="absolute"
                  style={{
                    left: 0,
                    width: 7,
                    height: 7,
                    borderLeft: "1.5px solid var(--pe-blue)",
                    [isTop ? "borderTop" : "borderBottom"]: "1.5px solid var(--pe-blue)",
                    top: isTop ? 0 : -7,
                  }}
                />
                <span
                  className="absolute"
                  style={{
                    right: 0,
                    width: 7,
                    height: 7,
                    borderRight: "1.5px solid var(--pe-blue)",
                    [isTop ? "borderTop" : "borderBottom"]: "1.5px solid var(--pe-blue)",
                    top: isTop ? 0 : -7,
                  }}
                />
              </div>
            );
          })}
          {/* single mono readout floating at the reticle center */}
          <div
            className="absolute font-[var(--font-pe-mono)]"
            style={{
              left: cx - 12,
              top: ((rTop + rBot) / 2) * DIAL_H - 8,
              width: 24,
              textAlign: "center",
              fontSize: 11,
              lineHeight: "16px",
              color: "var(--pe-blue)",
              background: "var(--paper-3)",
              pointerEvents: "none",
            }}
          >
            {focal + 1}
          </div>
        </>
      )}
    </div>
  );
}

// ── the fake chat column the dials index into ──────────────────────────────────────────────────
function FakeChat({ scroll }: { scroll: number }) {
  const { focal } = derive(scroll);
  const contentH = DIAL_H / WINDOW;
  const blockH = contentH / N;
  const translate = -scroll * (contentH - DIAL_H);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: 220,
        height: DIAL_H,
        border: "0.5px solid var(--line)",
        background: "var(--paper)",
      }}
    >
      <div style={{ transform: `translateY(${translate}px)`, willChange: "transform" }}>
        {TURNS.map((role, i) => (
          <div
            key={i}
            className="px-3 py-2"
            style={{
              height: blockH,
              borderBottom: "0.5px solid var(--line-soft)",
              borderLeft: `2px solid ${role === "user" ? "var(--user-line)" : "var(--pea-line)"}`,
              background:
                i === focal ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)" : "transparent",
            }}
          >
            <div className="flex items-baseline gap-2">
              <span
                className="font-[var(--font-pe-mono)]"
                style={{
                  fontSize: 10,
                  color: i === focal ? "var(--pe-blue)" : "var(--muted-foreground)",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[11px] font-semibold" style={{ color: "var(--foreground)" }}>
                {role === "user" ? "you" : "pea"}
              </span>
            </div>
            <div className="mt-1 space-y-1">
              <div
                style={{ height: 4, width: "88%", background: "var(--line)", borderRadius: 2 }}
              />
              <div
                style={{ height: 4, width: "62%", background: "var(--line-soft)", borderRadius: 2 }}
              />
            </div>
          </div>
        ))}
      </div>
      {/* aperture scrim — the window the dials reticle mirrors */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--paper) 55%, transparent), transparent 22%)",
          height: "100%",
        }}
      />
    </div>
  );
}

// ── SECTION 2: the same panel at three color intensities ────────────────────────────────────────
type Intensity = "mono" | "balanced" | "full";
type Status = "done" | "running" | "ready" | "stale" | "failed" | "queued";

const ROWS: { name: string; value: string; status: Status }[] = [
  { name: "wall-basic-200", value: "1,284", status: "done" },
  { name: "door-single-flush", value: "312", status: "running" },
  { name: "window-fixed", value: "97", status: "ready" },
  { name: "ceiling-compound", value: "44", status: "stale" },
  { name: "railing-guard", value: "8", status: "failed" },
  { name: "casework-base", value: "156", status: "queued" },
];

// cat-hue per status (used only at balanced/full)
const STATUS_CAT: Record<Status, string> = {
  done: "green",
  running: "blue",
  ready: "slate",
  stale: "kiln",
  failed: "clay",
  queued: "lichen",
};

function StatusBadge({ status, intensity }: { status: Status; intensity: Intensity }) {
  const label = status.toUpperCase();
  if (intensity === "mono") {
    // no color — status carried by weight + a mono asterisk on the one that needs attention
    const attn = status === "failed";
    return (
      <span
        className="font-[var(--font-pe-mono)]"
        style={{
          fontSize: 10,
          letterSpacing: "0.06em",
          fontWeight: attn ? 700 : 500,
          color: attn ? "var(--foreground)" : "var(--muted-foreground)",
        }}
      >
        {attn ? "* " : ""}
        {label}
      </span>
    );
  }
  const cat = STATUS_CAT[status];
  // balanced: everything at /12 tint + /25 border; full: the same grammar, saturated a touch.
  const tint = intensity === "full" ? 18 : 12;
  const line = intensity === "full" ? 40 : 25;
  return (
    <span
      className="inline-flex items-center font-[var(--font-pe-mono)]"
      style={{
        fontSize: 10,
        letterSpacing: "0.06em",
        padding: "1px 6px",
        borderRadius: 2,
        color: `var(--cat-${cat})`,
        background: `color-mix(in srgb, var(--cat-${cat}) ${tint}%, transparent)`,
        border: `1px solid color-mix(in srgb, var(--cat-${cat}) ${line}%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

function DashboardPanel({
  intensity,
  route,
  title,
  note,
}: {
  intensity: Intensity;
  route: string;
  title: string;
  note: string;
}) {
  const stats = [
    { k: "elements", v: "1,901", cat: "blue" },
    { k: "errors", v: "3", cat: "clay" },
    { k: "duration", v: "4.2s", cat: "slate" },
    { k: "fresh", v: "98%", cat: "green" },
  ];
  // full route colors the stat-strip segment bar; balanced/mono leave it neutral.
  const barSegs = [
    { cat: "blue", pct: 46 },
    { cat: "green", pct: 28 },
    { cat: "lichen", pct: 14 },
    { cat: "clay", pct: 12 },
  ];

  return (
    <div style={{ border: "0.5px solid var(--line)", background: "var(--card)", borderRadius: 2 }}>
      {/* head */}
      <div
        className="flex items-baseline justify-between px-3 py-2"
        style={{ borderBottom: "0.5px solid var(--line)" }}
      >
        <div>
          <div className="text-[13px] font-semibold" style={{ color: "var(--foreground)" }}>
            {title}
          </div>
          <div
            className="font-[var(--font-pe-mono)]"
            style={{ fontSize: 10, color: "var(--muted-foreground)" }}
          >
            {route}
          </div>
        </div>
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, color: "var(--muted-foreground)" }}
        >
          [{intensity.toUpperCase()}]
        </span>
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-4" style={{ borderBottom: "0.5px solid var(--line)" }}>
        {stats.map((s, i) => (
          <div
            key={s.k}
            className="px-3 py-2"
            style={{ borderLeft: i === 0 ? "none" : "0.5px solid var(--line-soft)" }}
          >
            <div
              className="font-[var(--font-pe-mono)]"
              style={{
                fontSize: 18,
                lineHeight: 1,
                color: intensity === "full" ? `var(--cat-${s.cat})` : "var(--foreground)",
              }}
            >
              {s.v}
            </div>
            <div
              className="mt-1 font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--muted-foreground)" }}
            >
              {s.k.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* segment bar — colored ONLY at full */}
      <div
        className="flex h-1.5 w-full overflow-hidden"
        style={{ borderBottom: "0.5px solid var(--line)" }}
      >
        {barSegs.map((seg, i) => (
          <div
            key={i}
            style={{
              width: `${seg.pct}%`,
              background:
                intensity === "full"
                  ? `var(--cat-${seg.cat})`
                  : `color-mix(in srgb, var(--foreground) ${18 - i * 3}%, transparent)`,
            }}
          />
        ))}
      </div>

      {/* table */}
      <table className="w-full border-collapse">
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.name} style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
              <td
                className="px-3 py-1.5 font-[var(--font-pe-mono)]"
                style={{ fontSize: 11, color: "var(--foreground)" }}
              >
                {r.name}
              </td>
              <td
                className="px-3 py-1.5 text-right font-[var(--font-pe-mono)]"
                style={{ fontSize: 11, color: "var(--muted-foreground)" }}
              >
                {r.value}
              </td>
              <td className="px-3 py-1.5 text-right">
                <StatusBadge status={r.status} intensity={intensity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* alert line */}
      <div
        className="flex items-center gap-2 px-3 py-2 font-[var(--font-pe-mono)]"
        style={{
          fontSize: 10,
          borderTop: "0.5px solid var(--line)",
          color:
            intensity === "mono"
              ? "var(--muted-foreground)"
              : intensity === "balanced"
                ? "var(--cat-green)"
                : "var(--cat-clay)",
          background:
            intensity === "full"
              ? "color-mix(in srgb, var(--cat-clay) 10%, transparent)"
              : intensity === "balanced"
                ? "color-mix(in srgb, var(--cat-green) 8%, transparent)"
                : "transparent",
        }}
      >
        <span>
          {intensity === "mono"
            ? "1 row failed. review railing-guard."
            : intensity === "balanced"
              ? "sync complete — 1 row needs review."
              : "railing-guard failed validation — 3 warnings pending."}
        </span>
      </div>

      {/* actions — mono keeps EXACTLY ONE accent (the primary) */}
      <div
        className="flex justify-end gap-2 px-3 py-2"
        style={{ borderTop: "0.5px solid var(--line)" }}
      >
        <button
          className="px-3 py-1 text-[12px]"
          style={{
            borderRadius: 2,
            border: "1px solid var(--line-2)",
            background: "transparent",
            color: "var(--foreground)",
          }}
        >
          Cancel
        </button>
        <button
          className="px-3 py-1 text-[12px] font-semibold"
          style={{
            borderRadius: 2,
            border: "1px solid var(--pe-blue)",
            background: "var(--pe-blue)",
            color: "var(--primary-foreground)",
          }}
        >
          Run
        </button>
      </div>

      <div className="px-3 pb-3 pt-1">
        <p className="text-[11px] leading-snug" style={{ color: "var(--muted-foreground)" }}>
          {note}
        </p>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────────────────────────
function PocDial() {
  const [scroll, setScroll] = useState(0.28);
  const [playing, setPlaying] = useState(false);
  const dirRef = useRef(1);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setScroll((s) => {
        let next = s + dirRef.current * dt * 0.14; // slow ping-pong sweep
        if (next >= 1) {
          next = 1;
          dirRef.current = -1;
        } else if (next <= 0) {
          next = 0;
          dirRef.current = 1;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      {/* hover-reveal for the slim variant's turn numbers — scoped, self-contained */}
      <style>{`
        .poc-dial-slim .band .num { opacity: 0; transition: opacity .12s ease; }
        .poc-dial-slim .band:hover .num { opacity: 1; }
        .poc-dial-slim .band:hover { opacity: 1 !important; }
      `}</style>

      <div className="page-wrap py-8">
        {/* page header */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1
              className="m-0 text-[22px] font-semibold"
              style={{ fontFamily: "var(--font-pe-display)", color: "var(--pe-blue)" }}
            >
              POC — Dial diet &amp; color budget
            </h1>
            <p
              className="mt-1 max-w-[62ch] text-[13px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Two independent judgements. Section 1 asks how thin the position instrument can get
              before it stops being readable. Section 2 asks where the color line sits for a route
              you stare at for six hours. Mock data; both themes.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* ── SECTION 1 ─────────────────────────────────────────────────────────────────────── */}
        <section className="mb-14">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="m-0 text-[15px] font-semibold" style={{ color: "var(--foreground)" }}>
              1 · MapDial diet
            </h2>
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--muted-foreground)" }}
            >
              SEGMENTS: <span style={{ color: "var(--user-line)" }}>■ you</span>{" "}
              <span style={{ color: "var(--pea-line)" }}>■ pea</span>{" "}
              <span style={{ color: "var(--pe-blue)" }}>■ focal</span>
            </span>
          </div>

          {/* scrub controls */}
          <div className="mb-5 flex items-center gap-4">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="px-3 py-1 text-[12px]"
              style={{
                borderRadius: 2,
                border: "1px solid var(--line-2)",
                background: playing ? "var(--pe-blue)" : "transparent",
                color: playing ? "var(--primary-foreground)" : "var(--foreground)",
              }}
            >
              {playing ? "Pause sweep" : "Auto sweep"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={scroll}
              onChange={(e) => {
                setPlaying(false);
                setScroll(Number(e.target.value));
              }}
              className="w-64"
              aria-label="Scroll position"
              style={{ accentColor: "var(--pe-blue)" }}
            />
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 11, color: "var(--muted-foreground)" }}
            >
              scroll {(scroll * 100).toFixed(0)}% · focal turn {derive(scroll).focal + 1}/{N}
            </span>
          </div>

          {/* fake chat + three dials */}
          <div className="flex items-start gap-6">
            <div>
              <div
                className="mb-2 font-[var(--font-pe-mono)]"
                style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--muted-foreground)" }}
              >
                FAKE CHAT LANE
              </div>
              <FakeChat scroll={scroll} />
            </div>

            {[
              {
                v: "ref" as const,
                label: "(a) 104px — current reference",
                desc: "14px rounded bars · focal fattens + haloes · candlestick aperture · number rides the focal band",
              },
              {
                v: "slim" as const,
                label: "(b) 64px — slim",
                desc: "8px hard-square bars · numbers on hover only · square reticle box",
              },
              {
                v: "ultra" as const,
                label: "(c) 44px — ultra-slim",
                desc: "2px ticks · bracket-mark aperture · single mono readout floats at the reticle",
              },
            ].map((item) => (
              <div key={item.v}>
                <div
                  className="mb-2 font-[var(--font-pe-mono)]"
                  style={{ fontSize: 10, letterSpacing: "0.04em", color: "var(--foreground)" }}
                >
                  {item.label}
                </div>
                <Dial variant={item.v} scroll={scroll} />
                <p
                  className="mt-2 text-[11px] leading-snug"
                  style={{ width: item.v === "ref" ? 150 : 130, color: "var(--muted-foreground)" }}
                >
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── SECTION 2 ─────────────────────────────────────────────────────────────────────── */}
        <section>
          <h2 className="m-0 mb-3 text-[15px] font-semibold" style={{ color: "var(--foreground)" }}>
            2 · Color budget
          </h2>
          <p className="mb-5 max-w-[70ch] text-[13px]" style={{ color: "var(--muted-foreground)" }}>
            The same dashboard panel — stat strip, six-row table, alert, two actions — at three
            color intensities. Each is labeled with the route type it suits.
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            <DashboardPanel
              intensity="mono"
              route="→ chat"
              title="Working route"
              note="Near-monochrome. Exactly one accent occurrence: the PE Blue Run action. Statuses ride weight + a mono asterisk, not hue. What a route you live in should feel like."
            />
            <DashboardPanel
              intensity="balanced"
              route="→ family-types"
              title="Balanced"
              note="cat-* badges at /12 tint + /25 border. One green success moment (the alert), blue action. Color clarifies category without shouting."
            />
            <DashboardPanel
              intensity="full"
              route="→ ops"
              title="Dashboard"
              note="Full cat palette on badges, colored stat numbers + segment bar, green + blue + clay all present. Legible at a glance; fatiguing to sit inside."
            />
          </div>
        </section>
      </div>
    </div>
  );
}
