import { useEffect, useRef, useState } from "react";

import {
  mintSelector,
  resolveTarget,
  sessionLabel,
  type SessionFacts,
  type TargetSelector,
} from "#/host/target";
import {
  ageLabel,
  chipDescriptor,
  LaneBadge,
  LiveDot,
  toneColor,
  TONE_STYLE,
} from "#/host/target-ui";

/**
 * The target chip + picker. The picker is a one-consumer patch bay: a wire gutter on the left
 * draws this surface's relationship to each session — solid blue = pinned, dashed = inferred,
 * faint kiln wires to every candidate = ambiguous (refusing to guess), clay stub = pin dangling.
 *
 * Pure props (selector in, pin out) so the composer, routes, and the docs page all render the
 * same component — real data or scripted.
 */

const HEAD_H = 30;
const ROW_H = 38;
const GUTTER = 26;

export function TargetChip({
  selector,
  sessions,
  onPin,
  nowMs,
  dropUp = false,
  consumerLabel = "this chat",
  defaultOpen = false,
}: {
  selector: TargetSelector;
  sessions: SessionFacts[];
  onPin: (selector: TargetSelector) => void;
  /** Observation clock for age readouts; defaults to render time. */
  nowMs?: number;
  /** Open the panel above the chip (composer) instead of below (docs/routes). */
  dropUp?: boolean;
  consumerLabel?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const resolution = resolveTarget(sessions, selector);
  const chip = chipDescriptor(resolution);
  const now = nowMs ?? Date.now();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const resolvedId = resolution.kind === "resolved" ? resolution.session.sessionId : undefined;
  const candidateIds =
    resolution.kind === "ambiguous"
      ? new Set(resolution.candidates.map((c) => c.sessionId))
      : undefined;

  // wire endpoints — jack at the header center, each session row center below the auto row
  const jackY = HEAD_H / 2;
  const rowY = (i: number) => HEAD_H + ROW_H * (i + 1) + ROW_H / 2 - 4;
  const bodyH = HEAD_H + ROW_H * (sessions.length + 1);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={chip.detail}
        className="tele inline-flex h-7 items-center gap-1.5 px-2"
        style={{ fontSize: 11, borderRadius: 2, ...TONE_STYLE[chip.tone] }}
      >
        <LiveDot
          tone={chip.tone}
          lane={resolution.kind === "resolved" ? resolution.session.lane : undefined}
        />
        <span className="max-w-44 truncate">{chip.text}</span>
      </button>

      {open ? (
        <div
          className={`absolute left-0 z-30 w-80 ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}
          style={{
            border: "0.5px solid var(--line-2)",
            background: "var(--popover, var(--paper-2))",
            borderRadius: 2,
          }}
        >
          <div className="relative" style={{ minHeight: bodyH }}>
            {/* wire gutter — the compressed patch bay */}
            <svg
              width={GUTTER}
              height={bodyH}
              className="absolute left-0 top-0"
              style={{ pointerEvents: "none" }}
            >
              <circle cx={10} cy={jackY} r={2.5} fill={toneColor(chip.tone)} />
              {sessions.map((s, i) => {
                const y = rowY(i);
                const wire = (stroke: string, dashed: boolean, opacity = 1, width = 1.25) => (
                  <path
                    key={s.sessionId}
                    d={`M 10 ${jackY + 4} C 10 ${jackY + 16}, 16 ${y - 16}, 16 ${y - 6} L 16 ${y - 4} Q 16 ${y} 20 ${y} L ${GUTTER} ${y}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={width}
                    strokeDasharray={dashed ? "4 3" : undefined}
                    opacity={opacity}
                  />
                );
                if (s.sessionId === resolvedId)
                  return wire(
                    toneColor(chip.tone),
                    resolution.kind === "resolved" && resolution.mode === "implicit",
                    1,
                    1.5,
                  );
                if (candidateIds?.has(s.sessionId)) return wire("var(--cat-kiln)", true, 0.55, 1);
                return null;
              })}
              {resolution.kind === "unresolved" && resolution.reason === "no-match" ? (
                <>
                  <path
                    d={`M 10 ${jackY + 4} v 10`}
                    stroke="var(--cat-clay)"
                    strokeWidth={1.25}
                    strokeDasharray="2 3"
                    fill="none"
                  />
                  <text x={7} y={jackY + 26} fontSize={9} fill="var(--cat-clay)">
                    ×
                  </text>
                </>
              ) : null}
            </svg>

            {/* consumer jack header */}
            <div
              className="flex items-baseline justify-between py-1.5 pr-3"
              style={{
                paddingLeft: GUTTER,
                height: HEAD_H,
                borderBottom: "0.5px solid var(--line-soft)",
              }}
            >
              <span
                className="font-[var(--font-pe-mono)]"
                style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--foreground)" }}
              >
                {consumerLabel.toUpperCase()}
              </span>
              <span
                className="truncate font-[var(--font-pe-mono)]"
                style={{ fontSize: 10, color: "var(--muted-foreground)", maxWidth: "60%" }}
              >
                {chip.detail}
              </span>
            </div>

            {/* auto row */}
            <PickRow
              height={ROW_H}
              active={selector === ""}
              onClick={() => onPin("")}
              left={
                <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                  auto — follow the sole session
                </span>
              }
              right={
                sessions.length > 1 ? (
                  <span
                    className="font-[var(--font-pe-mono)]"
                    style={{ fontSize: 10, color: "var(--cat-kiln)" }}
                  >
                    ambiguous now
                  </span>
                ) : undefined
              }
            />

            {sessions.map((s) => {
              const sel = mintSelector(s, sessions);
              const isResolved = s.sessionId === resolvedId;
              return (
                <PickRow
                  key={s.sessionId}
                  height={ROW_H}
                  active={isResolved && selector !== ""}
                  onClick={() => onPin(sel)}
                  left={
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <LiveDot tone={isResolved ? "pinned" : "implicit"} lane={s.lane} />
                      <span
                        className="truncate"
                        style={{ color: "var(--foreground)", fontSize: 12 }}
                      >
                        {sessionLabel(s)}
                      </span>
                      <LaneBadge lane={s.lane} />
                    </span>
                  }
                  right={
                    <span
                      className="whitespace-nowrap font-[var(--font-pe-mono)]"
                      style={{ fontSize: 9, color: "var(--muted-foreground)" }}
                    >
                      {sel} · pid {s.processId}
                      {s.observedAtUnixMs ? ` · ${ageLabel(s.observedAtUnixMs, now)}` : ""}
                    </span>
                  }
                />
              );
            })}

            {sessions.length === 0 ? (
              <div
                className="py-2 pr-3 text-[11px]"
                style={{ paddingLeft: GUTTER, color: "var(--muted-foreground)" }}
              >
                no sessions connected — open Revit or spawn a sandbox
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickRow({
  left,
  right,
  active,
  onClick,
  height,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  height: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 pr-3 text-left"
      style={{
        height,
        paddingLeft: GUTTER,
        borderBottom: "0.5px solid var(--line-soft)",
        background: active ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)" : "transparent",
        cursor: "pointer",
      }}
    >
      {left}
      {right}
    </button>
  );
}
