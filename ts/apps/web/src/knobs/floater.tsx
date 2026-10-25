/**
 * Dev-only tuning, dynamically imported by the shell. Overrides die on refresh.
 * EXCEPTION to SURFACE-PHILOSOPHY P1: native range/colour controls have no kit primitive.
 * The deliberately separate dev skin remains bounded to this floater; production never loads it.
 */
import { useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
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

const TOOL: CSSProperties = {
  position: "fixed",
  right: 8,
  bottom: 8,
  zIndex: "var(--z-dev)" as unknown as number,
  font: "12px/1.5 ui-monospace, Consolas, monospace",
  color: "#d4ff3a",
  background: "#111",
  border: "1px dashed #d4ff3a",
  borderRadius: 6,
  boxShadow: "0 4px 18px #0008",
  colorScheme: "dark",
};
const BUTTON: CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "transparent",
  border: "1px solid currentColor",
  borderRadius: 3,
  padding: "2px 6px",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const INPUT: CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "#202020",
  border: "1px solid #d4ff3a44",
  borderRadius: 3,
  minWidth: 0,
  padding: "2px 4px",
};
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Resolve a theme role only when the colour changes, not on every slider event. */
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
  return `#${[...ctx.getImageData(0, 0, 1, 1).data]
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function ColourControl({ path, value }: { path: string; value: string }) {
  const hex = useMemo(() => hexOf(value), [value]);
  return (
    <>
      <input
        id={path}
        type="color"
        value={hex}
        onChange={(e) => setKnob(path, e.currentTarget.value)}
        style={{ width: 36, height: 24, padding: 0, border: 0, background: "none" }}
      />
      <span>{value}</span>
    </>
  );
}

function Control({ path, knob }: { path: string; knob: Knob }): ReactNode {
  const value = overrideOf(path) ?? knob.default;
  const [draft, setDraft] = useState<string | null>(null);
  const write = (next: unknown) => setKnob(path, next);
  switch (knob.kind) {
    case "number": {
      const shown = draft ?? String(value as number);
      const commit = () => {
        if (draft !== null && draft.trim()) write(Number(draft));
        setDraft(null);
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
              // Captures commit on release; visual sliders paint during the drag.
              if (knob.cost === "refetch") setDraft(e.currentTarget.value);
              else write(e.currentTarget.valueAsNumber);
            }}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            onPointerCancel={() => setDraft(null)}
            style={{ width: 100, minWidth: 40, accentColor: "#d4ff3a" }}
          />
          <input
            aria-label={`${knob.label} value`}
            type="number"
            min={knob.min}
            max={knob.max}
            step={knob.step}
            value={shown}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(null);
              }
            }}
            style={{ ...INPUT, width: 68 }}
          />
          <span style={{ width: 22, opacity: 0.65 }}>{knob.unit}</span>
        </>
      );
    }
    case "colour":
      return <ColourControl path={path} value={value as string} />;
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
          style={INPUT}
        >
          {knob.options.map((option) => (
            <option key={option} value={option}>
              {words(option)}
            </option>
          ))}
        </select>
      );
    case "set": {
      const on = new Set(value as readonly string[]);
      const options = [...new Set([...offeredOf(path), ...on])];
      return options.length ? (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", maxWidth: 250 }}>
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
      ) : (
        <span style={{ opacity: 0.55 }}>no context categories</span>
      );
    }
  }
}

export default function KnobsFloater(): ReactNode {
  useSyncExternalStore(subscribe, knobVersion, knobVersion);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [said, setSaid] = useState("");
  const modules = knobModules();
  if (!modules.length) return null;
  const changed = changedCount();
  if (!open)
    return (
      <button
        type="button"
        style={{ ...BUTTON, ...TOOL, padding: "3px 10px" }}
        onClick={() => setOpen(true)}
      >
        knobs{changed ? ` · ${changed} changed` : ""}
      </button>
    );
  const groups = modules.flatMap(({ name, source, spec }) =>
    Object.entries(spec).flatMap(([group, knobs]) => {
      const entries = Object.entries(knobs).filter(
        ([key, knob]) =>
          (!onlyChanged || overrideOf(`${name}.${group}.${key}`) !== undefined) &&
          `${name} ${words(group)} ${key} ${knob.label}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      );
      return entries.length ? [{ name, source, group, entries }] : [];
    }),
  );
  return (
    <div
      data-knobs=""
      role="region"
      aria-label="Development knobs"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") setOpen(false);
      }}
      style={{
        ...TOOL,
        width: 500,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "75vh",
        minWidth: 300,
        resize: "both",
        overflow: "auto",
        padding: "0 10px 10px",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: TOOL.background,
          padding: "8px 0",
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <strong style={{ flex: 1 }}>knobs · {changed} changed</strong>
          <button
            type="button"
            style={BUTTON}
            disabled={!changed}
            onClick={() => {
              void navigator.clipboard
                .writeText(copyText())
                .then(() => setSaid(`copied ${changed}`))
                .catch((e: unknown) => setSaid(`copy failed: ${String(e)}`));
            }}
          >
            Copy
          </button>
          <button type="button" style={BUTTON} disabled={!changed} onClick={() => resetKnob()}>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input
            aria-label="Find knob"
            type="search"
            placeholder="Find knob…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ ...INPUT, flex: 1 }}
          />
          <label>
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(e) => setOnlyChanged(e.currentTarget.checked)}
            />{" "}
            changed
          </label>
        </div>
        <div style={{ opacity: 0.6 }}>dev only · refresh clears · orange waits for release</div>
        <div role="status">{said}</div>
      </div>
      {!groups.length && <div>No matching knobs</div>}
      {groups.map(({ name, source, group, entries }) => (
        <details
          key={`${name}.${group}`}
          open={query || onlyChanged ? true : undefined}
          style={{ borderTop: "1px solid #d4ff3a44", padding: "4px 0" }}
        >
          <summary style={{ cursor: "pointer", padding: "3px 0" }}>
            {name} / {words(group)}
            <span style={{ opacity: 0.55 }}> · {entries.length}</span>
          </summary>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span style={{ opacity: 0.5, overflowWrap: "anywhere" }}>
              {source.split("/").slice(-2).join("/")}
            </span>
            <button
              type="button"
              style={BUTTON}
              aria-label={`Reset ${name}.${group}`}
              onClick={() => resetKnob(`${name}.${group}`)}
            >
              Reset group
            </button>
          </div>
          {entries.map(([key, knob]) => {
            const path = `${name}.${group}.${key}`;
            const held = overrideOf(path) !== undefined;
            return (
              <div
                key={path}
                data-knob={path}
                style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 30 }}
              >
                <label
                  htmlFor={path}
                  style={{
                    flex: 1,
                    minWidth: 90,
                    fontWeight: held ? 700 : 400,
                    color: knob.cost === "refetch" ? "#ffb44d" : "inherit",
                  }}
                >
                  {knob.label}
                </label>
                <Control path={path} knob={knob} />
                <button
                  type="button"
                  style={BUTTON}
                  disabled={!held}
                  onClick={() => resetKnob(path)}
                  aria-label={`Reset ${path}`}
                >
                  ↺
                </button>
              </div>
            );
          })}
        </details>
      ))}
    </div>
  );
}
