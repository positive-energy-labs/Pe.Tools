/**
 * The dev knobs floater: a pill fixed bottom-right that opens the panel of every declared knob.
 * Mounted once by the app shell under `import.meta.env.DEV`, behind a dynamic import, so a
 * production bundle never carries it. Styled to look alien to the product on purpose, like the
 * protoui switcher (`.agents/skills/loop.protoui/SKILL.md`): it is a tool on top of the page.
 *
 * EXCEPTION to SURFACE-PHILOSOPHY P1 ("inputs only through the kit"): this is a dev tool, not a
 * route surface, and the kit has no range or colour primitive. Native `<input>`/`<select>` keep
 * it small. The list census permits this file only. Boundary: no route renders this, and
 * production never bundles it.
 */
import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { tokenRef } from "@pe/kit/lib/token";
import {
  changedCount,
  copyText,
  knobModules,
  knobVersion,
  offeredOf,
  overrideOf,
  resetKnob,
  setKnob,
  subscribe,
  type Knob,
} from "./knobs";

// Alien on purpose: raw values, not kit tokens, so nobody mistakes it for the design.
const ALIEN: CSSProperties = {
  position: "fixed",
  right: 8,
  bottom: 8,
  zIndex: "var(--z-dev)" as unknown as number,
  font: "11px/1.35 ui-monospace, Consolas, monospace",
  color: "#d4ff3a",
  background: "#111",
  border: "1px dashed #d4ff3a",
  borderRadius: 6,
  boxShadow: "0 4px 18px #0008",
};
const REFETCH: CSSProperties = { color: "#111", background: "#ff9f1a", padding: "0 3px" };
const LIVE: CSSProperties = { opacity: 0.55 };
const BUTTON: CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "transparent",
  border: "1px solid currentColor",
  borderRadius: 3,
  padding: "0 5px",
  cursor: "pointer",
};

/** A kit token role (`viz-1`, `alarm`) as `#rrggbb`, for the colour input's swatch. */
function hexOf(role: string): string {
  if (/^#[\da-f]{6}$/i.test(role)) return role;
  if (role === "theme") return "#808080";
  const probe = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
  probe.style.color = tokenRef(role);
  document.body.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const ctx = probe.getContext("2d")!;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
}

function Control({ path, knob }: { path: string; knob: Knob }): ReactNode {
  const held = overrideOf(path);
  const value = held === undefined ? knob.default : held;
  const write = (next: unknown) => setKnob(path, next);
  // A refetch knob commits on release: every drag step would otherwise queue a Revit capture.
  const [dragging, setDragging] = useState<number | null>(null);
  switch (knob.kind) {
    case "number": {
      const shown = dragging ?? (value as number);
      const commit = () => {
        if (dragging !== null) write(dragging);
        setDragging(null);
      };
      return (
        <>
          <input
            id={path}
            type="range"
            min={knob.min}
            max={knob.max}
            step={knob.step}
            value={shown}
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              if (knob.cost === "refetch") setDragging(next);
              else write(next);
            }}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            style={{ width: 110, accentColor: "#d4ff3a" }}
          />
          <span style={{ minWidth: 40, textAlign: "right" }}>{String(shown)}</span>
        </>
      );
    }
    case "colour":
      return (
        <>
          <input
            id={path}
            type="color"
            value={hexOf(value as string)}
            onChange={(e) => write(e.currentTarget.value)}
            style={{ width: 28, height: 16, padding: 0, border: 0, background: "none" }}
          />
          <span style={{ minWidth: 60 }}>{value as string}</span>
        </>
      );
    case "boolean":
      return (
        <input
          id={path}
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => write(e.currentTarget.checked)}
        />
      );
    case "choice":
      return (
        <select
          id={path}
          value={value as string}
          onChange={(e) => write(e.currentTarget.value)}
          style={{ font: "inherit", color: "#111" }}
        >
          {knob.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    case "set": {
      const on = new Set(value as readonly string[]);
      const options = offeredOf(path);
      if (!options.length) return <span style={LIVE}>nothing offered</span>;
      return (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "0 8px", maxWidth: 260 }}>
          {options.map((option) => (
            <label key={option} style={{ whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={on.has(option)}
                onChange={(e) =>
                  write(options.filter((o) => (o === option ? e.currentTarget.checked : on.has(o))))
                }
              />{" "}
              {option}
            </label>
          ))}
        </span>
      );
    }
  }
}

export default function KnobsFloater(): ReactNode {
  useSyncExternalStore(subscribe, knobVersion, knobVersion);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  const modules = knobModules();
  if (!modules.length) return null;
  const changed = changedCount();
  if (!open)
    return (
      <button
        type="button"
        style={{ ...BUTTON, ...ALIEN, padding: "2px 8px" }}
        onClick={() => setOpen(true)}
      >
        knobs{changed ? ` · ${changed} changed` : ""}
      </button>
    );
  const copy = () => {
    const text = copyText();
    void navigator.clipboard
      .writeText(text)
      .then(() => setSaid(text ? `copied ${changed}` : "nothing changed"))
      .catch((e: unknown) => setSaid(`copy failed: ${String(e)}`));
  };
  return (
    <div
      data-knobs=""
      style={{
        ...ALIEN,
        width: 430,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "70vh",
        overflow: "auto",
        padding: 8,
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: ALIEN.background,
          display: "flex",
          gap: 6,
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <strong style={{ flex: 1 }}>knobs · dev only · refresh clears</strong>
        <button type="button" style={BUTTON} onClick={copy} disabled={!changed}>
          Copy
        </button>
        <button type="button" style={BUTTON} onClick={() => resetKnob()} disabled={!changed}>
          Reset all
        </button>
        <button
          type="button"
          style={BUTTON}
          onClick={() => setOpen(false)}
          aria-label="Close knobs"
        >
          ×
        </button>
      </div>
      {said ? <div style={{ marginBottom: 6 }}>{said}</div> : null}
      {modules.map(({ name, spec }) =>
        Object.entries(spec).map(([group, knobs]) => (
          <fieldset
            key={`${name}.${group}`}
            style={{ border: "1px solid #d4ff3a44", margin: "0 0 6px", padding: "2px 6px" }}
          >
            <legend>
              {name}.{group}
            </legend>
            {Object.entries(knobs).map(([key, knob]) => {
              const path = `${name}.${group}.${key}`;
              const held = overrideOf(path) !== undefined;
              return (
                <div
                  key={path}
                  data-knob={path}
                  style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 20 }}
                >
                  <label htmlFor={path} style={{ flex: 1, fontWeight: held ? 700 : 400 }}>
                    {knob.label}
                  </label>
                  <Control path={path} knob={knob} />
                  <span style={knob.cost === "refetch" ? REFETCH : LIVE}>{knob.cost}</span>
                  <button
                    type="button"
                    style={{ ...BUTTON, visibility: held ? "visible" : "hidden" }}
                    onClick={() => resetKnob(path)}
                    aria-label={`Reset ${path}`}
                  >
                    ↺
                  </button>
                </div>
              );
            })}
          </fieldset>
        )),
      )}
    </div>
  );
}
