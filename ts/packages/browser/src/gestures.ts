// Trusted gestures: locate a control on every call, refuse what a person could not press, then
// dispatch real Input and read the result back. Promoted from the e2e lane (tests/e2e/cdp.ts).
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import type { CdpClient } from "./cdp.ts";

/** A control by accessible role/name (optionally inside the first shown `within`, a CSS selector), or a CSS selector. */
export type GestureTarget = string | { role?: string; name: string | RegExp; within?: string };
export interface GestureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type BlockedReason = "disabled" | "covered" | "absent" | "offscreen" | "focus";
export type GestureResult =
  | { outcome: "done"; rect: GestureRect | null; url: string; file?: string }
  | { outcome: "blocked"; reason: BlockedReason; hit?: string; url: string }
  | { outcome: "mismatch"; wanted: string; got: string; url: string };
export interface GestureOptions {
  /** Append one JSON line per gesture to this file. */
  trace?: string;
  /** With `trace`, also write a viewport PNG beside it after each gesture. */
  shots?: boolean;
}
/** BrowserPage and CdpClient both satisfy this. */
export type GesturePage = Pick<CdpClient, "send" | "evaluate">;

interface Wire {
  css: string | null;
  role: string | null;
  text: string | null;
  source: string | null;
  flags: string;
  within: string | null;
}
type Mode = "press" | "hover" | "locate" | "focus" | "value";
interface Probe {
  url: string;
  reason: BlockedReason | null;
  hit: string | null;
  rect: GestureRect | null;
  value: string | null;
}

/** Runs in Chrome; self-contained. Re-locates the target every call and never presses. */
async function probe(spec: Wire, mode: Mode): Promise<Probe> {
  const url = location.href;
  const out = (
    reason: BlockedReason | null,
    rect: GestureRect | null = null,
    hit: string | null = null,
    value: string | null = null,
  ) => ({ url, reason, hit, rect, value });
  const shown = (e: Element) =>
    e.getClientRects().length > 0 &&
    e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  // The first shown region: a route keeps a hidden Place's DOM, whose panes share the shown one's names.
  const root = spec.within
    ? ([...document.querySelectorAll(spec.within)].find(shown) ?? null)
    : document;
  if (!root) return out("absent");
  const implicit = (e: Element) => {
    const tag = e.tagName;
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "A") return e.hasAttribute("href") ? "link" : "";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "SELECT") return "combobox";
    if (tag !== "INPUT") return "";
    const type = (e as HTMLInputElement).type;
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    return ["checkbox", "radio"].includes(type) ? type : type === "range" ? "slider" : "textbox";
  };
  const names = (e: HTMLElement) =>
    [
      e.getAttribute("aria-label"),
      e.innerText,
      e.getAttribute("placeholder"),
      ...[...((e as HTMLInputElement).labels ?? [])].map((l) => l.innerText),
    ]
      .map((s) => (s ?? "").trim())
      .filter(Boolean);
  const re = spec.source === null ? null : new RegExp(spec.source, spec.flags);
  const named = (e: HTMLElement) => names(e).some((l) => (re ? re.test(l) : l === spec.text));
  const pool = spec.css
    ? [...root.querySelectorAll<HTMLElement>(spec.css)]
    : [
        ...root.querySelectorAll<HTMLElement>(
          spec.role
            ? "*"
            : 'button, a, summary, input:not([type="hidden"]), textarea, select, [role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=option], [role=combobox], [role=checkbox], [role=radio], [role=switch], [role=textbox], [role=searchbox], [role=treeitem]',
        ),
      ].filter(
        (e) => (!spec.role || (e.getAttribute("role") || implicit(e)) === spec.role) && named(e),
      );
  const el = pool.find(shown);
  if (!el) return out("absent");
  const field = el.matches("input, textarea, select")
    ? (el as HTMLInputElement)
    : el.querySelector<HTMLInputElement>("input, textarea, select");
  const read = () => (field ? field.value : el.innerText);
  if (mode === "value") return out(null, null, null, read());
  if (mode === "focus") {
    const active = document.activeElement;
    if (!active || !(active === el || el.contains(active)))
      return out("focus", null, active ? active.tagName.toLowerCase() : null);
    // Typing appends: put the caret at the end so a click in the middle cannot split the value.
    if (field && "setSelectionRange" in field && typeof field.value === "string")
      try {
        field.setSelectionRange(field.value.length, field.value.length);
      } catch {
        // Some input types (email, number) refuse selection; their caret is already at the end.
      }
    return out(null, null, null, read());
  }
  const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  if (mode === "locate") return out(null, box(el.getBoundingClientRect()));
  if (mode === "press" && (el.matches(":disabled") || el.closest('[aria-disabled="true"]')))
    return out("disabled", box(el.getBoundingClientRect()));
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  // Re-read until the rect holds still for one frame (bounded), so the press point is current.
  let r = el.getBoundingClientRect();
  for (let frame = 0; frame < 20; frame++) {
    await new Promise(requestAnimationFrame);
    const next = el.getBoundingClientRect();
    const still = (["x", "y", "width", "height"] as const).every(
      (k) => Math.abs(next[k] - r[k]) < 0.5,
    );
    r = next;
    if (still) break;
  }
  if (!el.isConnected || !shown(el)) return out("absent");
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return out("offscreen", box(r));
  const top = document.elementFromPoint(x, y);
  if (!top) return out("offscreen", box(r));
  if (!(top === el || el.contains(top))) {
    const id = top.id ? `#${top.id}` : "";
    const label = (top.getAttribute("aria-label") ?? (top as HTMLElement).innerText ?? "")
      .trim()
      .slice(0, 80);
    return out("covered", box(r), `${top.tagName.toLowerCase()}${id}${label ? ` "${label}"` : ""}`);
  }
  return out(null, box(r));
}

const wire = (target: GestureTarget): Wire =>
  typeof target === "string"
    ? { css: target, role: null, text: null, source: null, flags: "", within: null }
    : {
        css: null,
        role: target.role ?? null,
        text: typeof target.name === "string" ? target.name : null,
        source: target.name instanceof RegExp ? target.name.source : null,
        flags: target.name instanceof RegExp ? target.name.flags : "",
        within: target.within ?? null,
      };
export const describeTarget = (target: GestureTarget | null) =>
  target === null
    ? "(focus)"
    : typeof target === "string"
      ? target
      : `${target.role ?? "control"} ${target.name}${target.within ? ` in ${target.within}` : ""}`;

const NAMED: Record<string, [code: string, vk: number, text?: string]> = {
  Enter: ["Enter", 13, "\r"],
  Escape: ["Escape", 27],
  Delete: ["Delete", 46],
  Backspace: ["Backspace", 8],
  Tab: ["Tab", 9],
  Home: ["Home", 36],
  End: ["End", 35],
  PageUp: ["PageUp", 33],
  PageDown: ["PageDown", 34],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowUp: ["ArrowUp", 38],
  ArrowRight: ["ArrowRight", 39],
  ArrowDown: ["ArrowDown", 40],
  " ": ["Space", 32, " "],
};
const MODIFIERS: Record<string, number> = { Alt: 1, Ctrl: 2, Control: 2, Meta: 4, Shift: 8 };

export function gestures(page: GesturePage, opts: GestureOptions = {}) {
  let serial = 0;
  const run = (target: GestureTarget, mode: Mode) => page.evaluate(probe, wire(target), mode);
  const blocked = (p: Probe): GestureResult => ({
    outcome: "blocked",
    reason: p.reason!,
    ...(p.hit ? { hit: p.hit } : {}),
    url: p.url,
  });
  const mouse = async (
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    rect: GestureRect,
  ) => {
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await page.send(
      "Input.dispatchMouseEvent",
      type === "mouseMoved"
        ? { type, ...point }
        : { type, ...point, button: "left", clickCount: 1 },
    );
  };
  const capture = async (file: string, clip: GestureRect | null) => {
    // A screenshot clip is in document coordinates; the probe's rect is viewport-relative.
    const scroll = clip ? await page.evaluate(() => ({ x: scrollX, y: scrollY })) : null;
    const shot = await page.send("Page.captureScreenshot", {
      format: "png",
      ...(clip && scroll
        ? { clip: { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y, scale: 1 } }
        : {}),
    });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(shot.data, "base64"));
  };
  const record = async (gesture: string, target: GestureTarget | null, result: GestureResult) => {
    if (!opts.trace) return result;
    const n = ++serial;
    const { dir, name } = parse(opts.trace);
    const shot = opts.shots
      ? join(dir, `${name}-${String(n).padStart(4, "0")}-${gesture}.png`)
      : undefined;
    if (shot) await capture(shot, null).catch(() => undefined);
    const rect = result.outcome === "done" ? result.rect : null;
    const line = {
      at: new Date().toISOString(),
      gesture,
      target: describeTarget(target),
      rect,
      ...result,
      ...(shot ? { shot } : {}),
    };
    await mkdir(dirname(opts.trace), { recursive: true });
    await appendFile(opts.trace, JSON.stringify(line) + "\n");
    return result;
  };
  const point = async (
    gesture: "click" | "hover",
    target: GestureTarget,
  ): Promise<GestureResult> => {
    const p = await run(target, gesture === "click" ? "press" : "hover");
    if (p.reason || !p.rect) return blocked(p);
    await mouse("mouseMoved", p.rect);
    if (gesture === "click") {
      await mouse("mousePressed", p.rect);
      await mouse("mouseReleased", p.rect);
    }
    return { outcome: "done", rect: p.rect, url: p.url };
  };
  /** Click, then require that focus landed inside the target. */
  const focus = async (target: GestureTarget): Promise<GestureResult | Probe> => {
    const clicked = await point("click", target);
    if (clicked.outcome !== "done") return clicked;
    const p = await run(target, "focus");
    return p.reason ? blocked(p) : { ...p, rect: clicked.rect };
  };
  const key = async (spec: string, modifiers = 0) => {
    const [, chord, keyName] = /^((?:(?:Alt|Ctrl|Control|Meta|Shift)\+)*)(.+)$/.exec(spec) ?? [];
    if (!keyName) throw new Error(`Unknown key ${spec}`);
    for (const part of chord.split("+").filter(Boolean)) modifiers |= MODIFIERS[part];
    const named = NAMED[keyName];
    // One key is one code point; a longer unnamed word is a typo, not text to type.
    if (!named && String.fromCodePoint(keyName.codePointAt(0)!) !== keyName)
      throw new Error(`Unknown key ${keyName}`);
    const upper = keyName.toUpperCase();
    // Only letters and digits have a virtual key equal to their char code ("." would read as Delete).
    const [code, vk, text] = named ?? [
      /^[A-Z]$/.test(upper) ? `Key${upper}` : /^\d$/.test(keyName) ? `Digit${keyName}` : "",
      /^[A-Z0-9]$/.test(upper) ? upper.charCodeAt(0) : 0,
      keyName,
    ];
    const base = { key: keyName, code, windowsVirtualKeyCode: vk, modifiers };
    // A chord (Ctrl/Alt/Meta) is a command, not text; Shift still types.
    const typed = text !== undefined && !(modifiers & 7) ? text : undefined;
    if (typed && !named) {
      await page.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        ...base,
        text: typed,
        unmodifiedText: typed,
      });
    } else {
      await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      if (typed) await page.send("Input.dispatchKeyEvent", { type: "char", ...base, text: typed });
    }
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const url = () => page.evaluate(() => location.href);

  return {
    /** Click a control. Blocked (disabled, covered, absent, offscreen) means nothing was pressed. */
    click: async (target: GestureTarget) => record("click", target, await point("click", target)),
    /** Click the first visible element matching a CSS selector. */
    clickAt: async (selector: string) => record("click", selector, await point("click", selector)),
    /** Move the pointer over a control (no disabled check). */
    hover: async (target: GestureTarget) => record("hover", target, await point("hover", target)),
    /** Click the control, require focus inside it, insert `text`, then read the value back. */
    async type(target: GestureTarget, text: string): Promise<GestureResult> {
      const focused = await focus(target);
      if ("outcome" in focused) return record("type", target, focused);
      const before = focused.value ?? "";
      await page.send("Input.insertText", { text });
      const after = await run(target, "value");
      if (after.reason) return record("type", target, blocked(after));
      const wanted = before + text;
      const got = after.value ?? "";
      return record(
        "type",
        target,
        got === wanted
          ? { outcome: "done", rect: focused.rect, url: after.url }
          : { outcome: "mismatch", wanted, got, url: after.url },
      );
    },
    /**
     * Press one key ("Enter", "a", "Ctrl+a", "Shift+Tab") into the focused element, or into
     * `target` after clicking it and checking focus. A printable key without Ctrl/Alt/Meta types.
     */
    async press(
      keySpec: string,
      options: { target?: GestureTarget; modifiers?: number } = {},
    ): Promise<GestureResult> {
      const target = options.target ?? null;
      let rect: GestureRect | null = null;
      if (target !== null) {
        const focused = await focus(target);
        if ("outcome" in focused) return record("press", target, focused);
        rect = focused.rect;
      }
      await key(keySpec, options.modifiers);
      return record("press", target, { outcome: "done", rect, url: await url() });
    },
    /** Write a PNG of the viewport, or of `target` after scrolling it into view. */
    async shot(file: string, target?: GestureTarget): Promise<GestureResult> {
      let rect: GestureRect | null = null;
      if (target !== undefined) {
        const p = await run(target, "hover");
        if (p.reason || !p.rect) return record("shot", target, blocked(p));
        rect = p.rect;
      }
      await capture(file, rect);
      return record("shot", target ?? null, { outcome: "done", rect, url: await url(), file });
    },
    /** The target's rect if it is rendered and visible now; null otherwise. Never scrolls or presses. */
    async locate(target: GestureTarget): Promise<GestureRect | null> {
      return (await run(target, "locate")).rect;
    },
  };
}
export type Gestures = ReturnType<typeof gestures>;
