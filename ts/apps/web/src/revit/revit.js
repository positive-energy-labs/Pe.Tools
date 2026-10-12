// Revit facsimile: one JSON-serialisable spec in, Revit-looking HTML out. No images, no state, no
// framework. The web app imports this module (`#/revit/revit.js`); pages get it as a classic script
// at /pages/revit.js, where the host turns the final `export { … }` line into `globalThis.rv = { … }`.
// Keep every other declaration un-exported, and keep that line last.
//
// State words, the same everywhere: `disabled`, `selected`, `checked`, `open`, `default`.
// Ids default from text (`button:OK`, `check:View All`, `<tree id>/CD3-11`), so an agent never names
// anything; give an explicit `id` only when two pieces share text. Layout is flow (`row`/`col`) with
// Revit's control sizes; an optional `at` box pins a piece at window coordinates when a capture must
// match to the pixel (halve a 200% capture after subtracting the window frame origin).
//
// Look lives in revit.css on the --rv-* tokens in base.css.

/**
 * @typedef {{ x: number, y: number, w?: number, h?: number }} At
 * @typedef {{ id?: string, at?: At, w?: number, h?: number, grow?: boolean }} Box
 * @typedef {{ from: number, to: number }} Scroll
 * @typedef {{ text: string, id?: string, depth?: number, open?: boolean, selected?: boolean, disabled?: boolean }} TreeRow
 * @typedef {string | { checked: boolean, disabled?: boolean }} Cell
 * @typedef {{ cells: Cell[], disabled?: boolean, current?: number } | { band: string, open?: boolean }} GridRow
 * @typedef {"up" | "down" | "add" | "remove" | "edit" | "new" | "copy" | "delete" | "sortAZ" | "sortZA" | "search"} Icon
 * @typedef {Box & (
 *   | { t: "row" | "col", items: Piece[], gap?: number }
 *   | { t: "spacer" }
 *   | { t: "rule" }
 *   | { t: "label", text: string, disabled?: boolean }
 *   | { t: "text", text: string, well?: boolean, strong?: boolean, disabled?: boolean }
 *   | { t: "link", text: string }
 *   | { t: "button", text: string, default?: boolean, disabled?: boolean }
 *   | { t: "check" | "radio", text: string, checked?: boolean, disabled?: boolean }
 *   | { t: "field", text: string, drop?: boolean, browse?: boolean, readOnly?: boolean, disabled?: boolean, placeholder?: boolean, icon?: Icon }
 *   | { t: "group", text: string, items?: Piece[] }
 *   | { t: "tabs", items: string[], selected: string, body?: Piece[] }
 *   | { t: "list", items: string[], selected?: string }
 *   | { t: "tree", rows: TreeRow[], scroll?: Scroll }
 *   | { t: "grid", columns: (string | { text: string, w: number })[], rows: GridRow[], scroll?: Scroll, rowHeight?: number, headHeight?: number, lift?: number }
 *   | { t: "tools", items: { icon: Icon, disabled?: boolean }[], dir?: "row" | "col", gap?: number }
 *   | { t: "image", src?: string, text?: string }
 * )} Piece
 * @typedef {{ name: string, value?: string, disabled?: boolean, checked?: boolean, button?: string, link?: boolean, editing?: boolean, number?: boolean }} PropRow
 * @typedef {{ text: string, open?: boolean, rows: PropRow[] }} PropGroup
 * @typedef {{ t: "dialog", title: string, caption?: "help" | "close" | "full", w?: number, h?: number, grip?: boolean, body: Piece[], buttons?: Piece[], padding?: string, gap?: number }} Dialog
 * @typedef {{ t: "palette", family: string, type: string, instance: string, groups: PropGroup[], dirty?: boolean, w?: number, h?: number, scroll?: Scroll }} Palette
 * @typedef {{ t: "task", title: string, instruction: string, icon?: "warning" | "error" | "info" | "shield", content?: string, links?: { text: string, note?: string }[], buttons?: string[], default?: string, expander?: string, verification?: { text: string, checked?: boolean }, w?: number }} Task
 * @typedef {{ label: string, glyph?: string, split?: boolean, selected?: boolean }} RibbonButton
 * @typedef {{ t: "ribbon", tabs: string[], selected: string, modify?: string, panels: { text: string, items: (RibbonButton | RibbonButton[])[] }[], options?: Piece[] }} Ribbon
 * @typedef {Dialog | Palette | Task | Ribbon} Spec
 * @typedef {{ at: string, text: string }} Note
 * @typedef {{ at: string, prop: string, from: unknown, to: unknown }} Change
 * @typedef {{ notes?: Note[], changed?: Set<string> }} RenderOptions
 */

const esc = (/** @type {unknown} */ v) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** @param {Record<string, unknown>} attrs */
const attrs = (attrs) =>
  Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== false && v !== null)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");

/** @param {Record<string, string | number | undefined>} style */
const css = (style) => {
  const s = Object.entries(style)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${typeof v === "number" ? `${v}px` : v}`)
    .join(";");
  return s || undefined;
};

// ── ids ──────────────────────────────────────────────────────────────────────────────────────

/** @param {Piece} p */
const idOf = (p) => p.id ?? ("text" in p ? `${p.t}:${p.text}` : p.t);

/** Every addressable thing in a spec, by id: pieces, tree rows, list items, grid rows, palette rows. */
const index = (/** @type {Spec} */ spec) => {
  /** @type {Map<string, Record<string, unknown>>} */
  const out = new Map();
  const add = (/** @type {string} */ id, /** @type {Record<string, unknown>} */ v) => {
    if (out.has(id)) throw Error(`rv: duplicate id "${id}"; give one of them an explicit id`);
    out.set(id, v);
  };
  const walk = (/** @type {Piece[] | undefined} */ pieces) => {
    for (const p of pieces ?? []) {
      const id = idOf(p);
      add(id, scalars(p));
      if (p.t === "row" || p.t === "col" || p.t === "group") walk(p.items);
      if (p.t === "tabs") {
        for (const tab of p.items) add(`${id}/${tab}`, { selected: tab === p.selected });
        walk(p.body);
      }
      if (p.t === "tree") {
        const ids = rowIds(id, p.rows);
        p.rows.forEach((r, i) => add(ids[i], scalars(r)));
      }
      if (p.t === "list") for (const item of p.items) add(`${id}/${item}`, { selected: item === p.selected });
      if (p.t === "grid")
        for (const r of p.rows)
          if ("band" in r) add(`${id}/${r.band}`, scalars(r));
          else add(`${id}/${cellText(r.cells[0])}`, { ...scalars(r), cells: r.cells.map(cellText).join(" | ") });
    }
  };
  if (spec.t === "dialog") {
    walk(spec.body);
    walk(spec.buttons);
  }
  if (spec.t === "palette")
    for (const g of spec.groups) {
      add(`group:${g.text}`, { open: g.open ?? true });
      for (const r of g.rows) add(`${g.text}/${r.name}`, scalars(r));
    }
  if (spec.t === "task") {
    for (const l of spec.links ?? []) add(`link:${l.text}`, scalars(l));
    for (const b of spec.buttons ?? []) add(`button:${b}`, { default: b === spec.default });
  }
  return out;
};

/** The state of one thing: its scalar fields, without children or geometry. */
const scalars = (/** @type {object} */ o) =>
  Object.fromEntries(
    Object.entries(o).filter(([k, v]) => typeof v !== "object" && !["t", "id", "w", "h", "grow", "gap"].includes(k)),
  );

const cellText = (/** @type {Cell | undefined} */ c) =>
  typeof c === "string" ? c : c ? (c.checked ? "[x]" : "[ ]") : "";

// ── diff and set ─────────────────────────────────────────────────────────────────────────────

/**
 * What changed from `a` to `b`, keyed by id. A thing only in `b` is `added`; only in `a`, `removed`.
 * @param {Spec} a @param {Spec} b @returns {Change[]}
 */
const diff = (a, b) => {
  const ia = index(a);
  const ib = index(b);
  /** @type {Change[]} */
  const out = [];
  for (const [id, va] of ia) {
    const vb = ib.get(id);
    if (!vb) {
      out.push({ at: id, prop: "removed", from: true, to: false });
      continue;
    }
    for (const prop of new Set([...Object.keys(va), ...Object.keys(vb)]))
      if ((va[prop] ?? false) !== (vb[prop] ?? false)) out.push({ at: id, prop, from: va[prop], to: vb[prop] });
  }
  for (const id of ib.keys()) if (!ia.has(id)) out.push({ at: id, prop: "added", from: false, to: true });
  return out;
};

/**
 * A copy of `spec` with the piece named `id` patched. Author state B as a few `set`s on state A.
 * On a palette the id is a row (`Mechanical/Loss Method`) or a group (`group:Mechanical`), so a
 * live reading can be written into the shell: `rv.set(palette, "Mechanical/Pressure Drop", { value })`.
 * @template {Spec} S @param {S} spec @param {string} id @param {Record<string, unknown>} patch @returns {S}
 */
const set = (spec, id, patch) => {
  const copy = structuredClone(spec);
  let hit = false;
  const walk = (/** @type {Piece[] | undefined} */ pieces) =>
    pieces?.forEach((p, i) => {
      if (idOf(p) === id) {
        pieces[i] = /** @type {Piece} */ ({ ...p, ...patch });
        hit = true;
      }
      if (p.t === "row" || p.t === "col" || p.t === "group") walk(p.items);
      if (p.t === "tabs") walk(p.body);
    });
  if (copy.t === "dialog") {
    walk(copy.body);
    walk(copy.buttons);
  }
  if (copy.t === "palette")
    copy.groups.forEach((g, gi) => {
      if (`group:${g.text}` === id) {
        copy.groups[gi] = { ...g, ...patch };
        hit = true;
      }
      g.rows.forEach((r, ri) => {
        if (`${g.text}/${r.name}` === id) {
          g.rows[ri] = { ...r, ...patch };
          hit = true;
        }
      });
    });
  if (!hit) throw Error(`rv.set: no piece "${id}"`);
  return copy;
};

// ── pieces ───────────────────────────────────────────────────────────────────────────────────

/** @type {Record<Icon, string>} outline paths on an 18px grid; `|` separates a solid part */
const ICONS = {
  up: "M17 3 H11 V15 H17 M11 9 H16|M4.2 16 V7 H2.5 L5 2.5 L7.5 7 H5.8 V16 Z",
  down: "M17 3 H11 V15 H17 M11 9 H16|M4.2 2 V11 H2.5 L5 15.5 L7.5 11 H5.8 V2 Z",
  add: "M7 2 H11 V7 H16 V11 H11 V16 H7 V11 H2 V7 H7 Z",
  remove: "M2 7.5 H16 V10.5 H2 Z",
  edit: "M3 15 L4 11 L13 2 L16 5 L7 14 Z M11 4 L14 7",
  new: "M4 6 H11 L14 9 V16 H4 Z M11 6 V9 H14|M3 1 L4 3 L6 3 L4.5 4.5 L5 7 L3 5.5 L1 7 L1.5 4.5 L0 3 L2 3 Z",
  copy: "M3 4 H11 V16 H3 Z M6 4 V1 H14 V13 H11",
  delete: "M4 6 H13 V16 H4 Z M2 1 L7 5 M7 1 L2 5",
  sortAZ: "M2 8 L4 2 L6 8 M2.7 6 H5.3 M2 10 H6 L2 16 H6 M13 2 V15 M10.5 12.5 L13 15.5 L15.5 12.5",
  sortZA: "M2 2 H6 L2 8 H6 M2 16 L4 10 L6 16 M2.7 14 H5.3 M13 2 V15 M10.5 12.5 L13 15.5 L15.5 12.5",
  search: "M7.5 2.5 A5 5 0 1 0 7.51 2.5 Z M11 11 L16 16",
};

const icon = (/** @type {Icon} */ name, /** @type {boolean | undefined} */ disabled) => {
  const [outline, solid] = ICONS[name].split("|");
  return `<svg class="rv-tool" viewBox="0 0 18 18"${attrs({ "data-disabled": disabled })} aria-hidden="true"><path d="${outline}"/>${solid ? `<path d="${solid}" data-solid/>` : ""}</svg>`;
};

/**
 * Each tree row's id under its tree: its text when unique in the tree, else its path from the root
 * (`Pipe Settings/Angles`), so repeated leaf names stay addressable without author-made ids. Rows
 * that share both text and path (five grilles under one system) carry an explicit `id`.
 * @param {string} tree @param {TreeRow[]} rows
 */
const rowIds = (tree, rows) => {
  const count = new Map();
  for (const r of rows) count.set(r.text, (count.get(r.text) ?? 0) + 1);
  /** @type {string[]} */
  const path = [];
  return rows.map((r) => {
    path.length = r.depth ?? 0;
    path.push(r.text);
    return `${tree}/${r.id ?? (count.get(r.text) > 1 ? path.join("/") : r.text)}`;
  });
};

/** Is there a later sibling at `depth` (does the connector run on down)? */
const continues = (/** @type {TreeRow[]} */ rows, /** @type {number} */ i, /** @type {number} */ depth) => {
  for (const r of rows.slice(i + 1)) {
    const d = r.depth ?? 0;
    if (d < depth) return false;
    if (d === depth) return true;
  }
  return false;
};

const scrollbar = (/** @type {Scroll | undefined} */ s) =>
  s
    ? `<span class="rv-grid-scroll"><span style="top:${s.from * 100}%;height:${(s.to - s.from) * 100}%"></span></span>`
    : "";

/** @param {Piece} p @param {RenderOptions} o @param {string} id */
const inner = (p, o, id) => {
  switch (p.t) {
    case "row":
    case "col":
      return p.items.map((c) => piece(c, o)).join("");
    case "spacer":
    case "rule":
      return "";
    case "label":
    case "text":
      return esc(p.text);
    case "link":
      return esc(p.text);
    case "button":
      return esc(p.text);
    case "check":
    case "radio":
      return esc(p.text);
    case "field":
      return `<span class="rv-field"${attrs({
        "data-readonly": p.readOnly,
        "data-disabled": p.disabled,
        "data-placeholder": p.placeholder,
        style: css({ height: p.h }),
      })}><span>${esc(p.text)}</span>${p.drop ? '<span class="rv-chevron"></span>' : ""}${p.icon ? icon(p.icon) : ""}</span>${p.browse ? '<span class="rv-ellipsis">...</span>' : ""}`;
    case "group":
      return `<span class="rv-group-title">${esc(p.text)}</span>${(p.items ?? []).map((c) => piece(c, o)).join("")}`;
    case "tabs":
      return `<div class="rv-tabstrip">${p.items
        .map((tab) => tag("span", `${id}/${tab}`, o, { class: "rv-tab", "data-selected": tab === p.selected }, esc(tab)))
        .join("")}</div><div class="rv-tabpage">${(p.body ?? []).map((c) => piece(c, o)).join("")}</div>`;
    case "list":
      return p.items
        .map((item) => tag("div", `${id}/${item}`, o, { class: "rv-list-item", "data-selected": item === p.selected }, esc(item)))
        .join("");
    case "tree": {
      const ids = rowIds(id, p.rows);
      return `<div class="rv-tree-rows">${p.rows
        .map((r, i) => {
          const depth = r.depth ?? 0;
          const guides = Array.from(
            { length: depth },
            (_, c) => `<span class="rv-tree-col"${attrs({ "data-line": continues(p.rows, i, c) })}></span>`,
          ).join("");
          const joint = `<span class="rv-tree-col" data-joint${attrs({ "data-up": i > 0, "data-down": continues(p.rows, i, depth) })}>${
            r.open === undefined ? "" : `<span class="rv-tree-box"${attrs({ "data-closed": !r.open })}></span>`
          }</span>`;
          return tag(
            "div",
            ids[i],
            o,
            { class: "rv-tree-item" },
            `${guides}${joint}<span class="rv-tree-label"${attrs({ "data-selected": r.selected, "data-disabled": r.disabled })}>${esc(r.text)}</span>`,
          );
        })
        .join("")}</div>${scrollbar(p.scroll)}`;
    }
    case "grid": {
      const cols = p.columns.map((c) => (typeof c === "string" ? { text: c, w: 0 } : c));
      const n = cols.length;
      const row = p.rowHeight ? `${p.rowHeight}px` : "var(--rv-row, 21px)";
      const style = css({
        "grid-template-columns": cols.map((c) => (c.w ? `${c.w}px` : "1fr")).join(" "),
        "grid-template-rows": `${p.headHeight ? `${p.headHeight}px` : row} repeat(${p.rows.length}, ${row}) 1fr`,
        "--rv-row": p.rowHeight ? `${p.rowHeight}px` : undefined,
        "--rv-lift": p.lift ? `${p.lift}px` : undefined,
      });
      const head = cols.map((c) => `<span class="rv-grid-head">${esc(c.text)}</span>`).join("");
      const body = p.rows
        .map((r) => {
          if ("band" in r)
            return tag(
              "span",
              `${id}/${r.band}`,
              o,
              { class: "rv-grid-band" },
              `<span>${esc(r.band)}</span>${r.open === undefined ? "" : `<span class="rv-grid-fold">${r.open ? "︽" : "︾"}</span>`}`,
            );
          const rid = `${id}/${cellText(r.cells[0])}`;
          const ring = o.changed?.has(rid);
          return r.cells
            .map((c, ci) =>
              `<span class="rv-grid-cell"${attrs({
                "data-split": ci < n - 1,
                "data-last": ci === n - 1,
                "data-disabled": r.disabled,
                "data-current": r.current === ci,
                "data-changed": ring,
                "data-rv": ci === 0 ? rid : undefined,
              })}>${
                typeof c === "string"
                  ? esc(c)
                  : `<span class="rv-check"${attrs({ "data-checked": c.checked, "data-disabled": c.disabled })}></span>`
              }${ci === 0 ? badges(rid, o) : ""}</span>`,
            )
            .join("");
        })
        .join("");
      const fill = cols
        .map((_, ci) => `<span class="rv-grid-fill"${attrs({ "data-split": ci < n - 1, "data-last": ci === n - 1 })}></span>`)
        .join("");
      return `<div class="rv-grid-table" style="${style}">${head}${body}${fill}</div>${scrollbar(p.scroll)}`;
    }
    case "tools":
      return p.items.map((t) => icon(t.icon, t.disabled)).join("");
    case "image":
      return p.src ? `<img src="${esc(p.src)}" alt="${esc(p.text)}">` : `<span>${esc(p.text)}</span>`;
  }
};

/** Class and flags of one piece's outer element. */
const shell = (/** @type {Piece} */ p) => {
  switch (p.t) {
    case "row":
    case "col":
      return { class: p.t === "row" ? "rv-hbox" : "rv-vbox", style: css({ gap: p.gap }) };
    case "spacer":
      return { class: "rv-spacer" };
    case "rule":
      return { class: "rv-rule" };
    case "label":
      return { class: "rv-label", "data-disabled": p.disabled };
    case "text":
      // Wrapping prose: an error message, a dialog's explanation. `well` sinks it into a white box.
      return { class: "rv-text", "data-well": p.well, "data-strong": p.strong, "data-disabled": p.disabled };
    case "link":
      return { class: "rv-anchor" };
    case "button":
      return { class: "rv-button", "data-default": p.default, "data-disabled": p.disabled };
    case "check":
    case "radio":
      return { class: `rv-${p.t}`, "data-checked": p.checked, "data-disabled": p.disabled };
    case "field":
      return { class: "rv-row rv-field-row" };
    case "group":
      return { class: "rv-group" };
    case "tabs":
      return { class: "rv-tabs" };
    case "list":
      return { class: "rv-list" };
    case "tree":
      return { class: "rv-well rv-tree" };
    case "grid":
      return { class: "rv-well rv-grid" };
    case "tools":
      return { class: "rv-tools", "data-dir": p.dir ?? "col", style: css({ gap: p.gap }) };
    case "image":
      return { class: "rv-image" };
  }
};

/** Notes anchored on `id`, as numbered badges. */
const badges = (/** @type {string} */ id, /** @type {RenderOptions} */ o) =>
  (o.notes ?? [])
    .map((n, i) => (n.at === id ? `<span class="rv-badge">${i + 1}</span>` : ""))
    .join("");

/** One element carrying an addressable id: change ring and note badges attach here. */
const tag = (
  /** @type {string} */ name,
  /** @type {string} */ id,
  /** @type {RenderOptions} */ o,
  /** @type {Record<string, unknown>} */ a,
  /** @type {string} */ body,
) => `<${name}${attrs({ ...a, "data-rv": id, "data-changed": o.changed?.has(id) })}>${body}${badges(id, o)}</${name}>`;

/** @param {Piece} p @param {RenderOptions} o */
const piece = (p, o) => {
  const id = idOf(p);
  const { style, ...a } = shell(p);
  const at = p.at;
  const geometry = css({
    position: at ? "absolute" : undefined,
    left: at ? at.x - 1 : undefined,
    top: at ? at.y - 1 : undefined,
    width: at?.w ?? p.w,
    height: at?.h ?? p.h,
    flex: p.grow ? "1 1 0" : undefined,
  });
  return tag("div", id, o, { ...a, style: [style, geometry].filter(Boolean).join(";") || undefined }, inner(p, o, id));
};

// ── windows ──────────────────────────────────────────────────────────────────────────────────

const X = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5"/></svg>';

const titlebar = (/** @type {string} */ title, /** @type {"help" | "close" | "full"} */ caption, /** @type {boolean} */ dock = false) =>
  `<div class="rv-titlebar"${attrs({ "data-dock": dock })}><span class="rv-titlebar-text">${esc(title)}</span><span class="rv-caption">${
    caption === "full" ? "<span>—</span><span>☐</span>" : caption === "help" ? "<span>?</span>" : ""
  }<span>${X}</span></span></div>`;

/** @param {Dialog} d @param {RenderOptions} o */
const dialog = (d, o) =>
  `<div class="rv" style="${css({ width: d.w, height: d.h })}">${titlebar(d.title, d.caption ?? "close")}<div class="rv-body"${attrs({
    style: css({ padding: d.padding, gap: d.gap }),
  })}>${d.body.map((p) => piece(p, o)).join("")}${
    d.buttons ? `<div class="rv-buttonbar">${d.buttons.map((p) => piece(p, o)).join("")}</div>` : ""
  }</div>${d.grip ? '<span class="rv-grip"></span>' : ""}</div>`;

/** @param {Palette} s @param {RenderOptions} o */
const palette = (s, o) => {
  const rows = s.groups
    .map((g) => {
      const head = tag(
        "div",
        `group:${g.text}`,
        o,
        { class: "rv-props-group" },
        `<span>${esc(g.text)}</span><span>${g.open === false ? "︾" : "︽"}</span>`,
      );
      if (g.open === false) return head;
      return (
        head +
        g.rows
          .map((r) => {
            const id = `${g.text}/${r.name}`;
            const value =
              r.button !== undefined
                ? `<span class="rv-props-button">${esc(r.button)}</span>`
                : r.checked !== undefined
                  ? `<span class="rv-check"${attrs({ "data-checked": r.checked, "data-disabled": r.disabled })}></span>`
                  : `<span class="rv-props-text">${esc(r.value)}</span>`;
            return `<span class="rv-props-name"${attrs({ "data-disabled": r.disabled, "data-rv": id, "data-changed": o.changed?.has(id) })}>${esc(r.name)}${badges(id, o)}</span><span class="rv-props-value"${attrs({
              "data-disabled": r.disabled,
              "data-number": r.number,
              "data-edit": r.editing,
              "data-changed": o.changed?.has(id),
            })}>${value}${r.link ? '<span class="rv-props-link"></span>' : ""}</span>`;
          })
          .join("")
      );
    })
    .join("");
  return `<div class="rv rv-props" style="${css({ width: s.w ?? 300, height: s.h })}">${titlebar("Properties", "close", true)}<div class="rv-props-type"><span class="rv-props-thumb">▭</span><span class="rv-props-selector">${esc(s.family)}<br>${esc(s.type)}</span><span class="rv-drop"></span></div><div class="rv-props-instance"><span class="rv-field"><span>${esc(s.instance)}</span><span class="rv-drop"></span></span><span class="rv-props-edit-type"><span class="rv-glyph" data-size="small">≡</span>Edit Type</span></div><div class="rv-props-body"><div class="rv-props-grid">${rows}</div>${scrollbar(s.scroll)}</div><div class="rv-props-foot"><span class="rv-anchor">Properties help</span><span class="rv-button"${attrs({ "data-disabled": !s.dirty })}>Apply</span></div></div>`;
};

const TASK_ICONS = {
  warning: '<path d="M16 3 L31 29 H1 Z" class="rv-icon-warning"/><rect x="14.5" y="11" width="3" height="10" rx="1" class="rv-icon-mark"/><circle cx="16" cy="25" r="1.8" class="rv-icon-mark"/>',
  error: '<circle cx="16" cy="16" r="15" class="rv-icon-error"/><text x="16" y="23" text-anchor="middle" class="rv-icon-text">✕</text>',
  info: '<circle cx="16" cy="16" r="15" class="rv-icon-info"/><text x="16" y="23" text-anchor="middle" class="rv-icon-text">i</text>',
  shield: '<path d="M16 2 L29 7 V16 C29 23 23 28 16 30 C9 28 3 23 3 16 V7 Z" class="rv-icon-shield"/>',
};

/**
 * A TaskDialog. Its fields are the journal's own: `TaskDialog "…"` is `instruction`, `'1001 : …` lines
 * are `links`, `CommonButtons` is `buttons`, `DefaultButton` is `default`.
 * @param {Task} s @param {RenderOptions} o
 */
const task = (s, o) =>
  `<div class="rv" style="${css({ width: s.w ?? 460 })}">${titlebar(s.title, "close")}<div class="rv-task"${attrs({ "data-icon": !!s.icon })}><div class="rv-task-head">${
    s.icon ? `<svg class="rv-icon" viewBox="0 0 32 32" aria-hidden="true">${TASK_ICONS[s.icon]}</svg>` : ""
  }<span class="rv-task-instruction">${esc(s.instruction)}</span></div>${s.content ? `<div class="rv-task-content">${esc(s.content)}</div>` : ""}${(s.links ?? [])
    .map((l) =>
      tag(
        "div",
        `link:${l.text}`,
        o,
        { class: "rv-cmdlink", "data-default": l.text === s.default },
        `<svg class="rv-cmdlink-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6 H8 V2 L15 8 L8 14 V10 H2 Z"/></svg><span class="rv-cmdlink-title">${esc(l.text)}</span>${l.note ? `<span class="rv-cmdlink-note">${esc(l.note)}</span>` : ""}`,
      ),
    )
    .join("")}</div><div class="rv-footer">${
    s.expander
      ? `<span class="rv-expander"><svg viewBox="0 0 17 17" aria-hidden="true"><circle cx="8.5" cy="8.5" r="7.5"/><path d="M5 5.5 L8.5 9 L12 5.5 M5 9 L8.5 12.5 L12 9"/></svg>${esc(s.expander)}</span>`
      : ""
  }${s.verification ? `<span class="rv-check"${attrs({ "data-checked": s.verification.checked })}>${esc(s.verification.text)}</span>` : ""}<span class="rv-footer-spacer"></span>${(s.buttons ?? [])
    .map((b) => tag("span", `button:${b}`, o, { class: "rv-button", "data-default": b === s.default }, esc(b)))
    .join("")}</div></div>`;

/** @param {Ribbon} s */
const ribbon = (s) =>
  `<div class="rv rv-ribbon"><div class="rv-ribbon-tabs"><span class="rv-ribbon-tab" data-file>File</span>${s.tabs
    .map((tab) => `<span class="rv-ribbon-tab"${attrs({ "data-selected": tab === s.selected })}>${esc(tab)}</span>`)
    .join("")}${s.modify ? `<span class="rv-ribbon-tab" data-modify>${esc(s.modify)}</span>` : ""}<span class="rv-ribbon-state">▭ ▾</span></div><div class="rv-ribbon-panels">${s.panels
    .map(
      (panel) =>
        `<div class="rv-panel"><div class="rv-panel-items">${panel.items
          .map((item) =>
            Array.isArray(item)
              ? `<span class="rv-rbtn-stack">${item.map((b) => press(b, true)).join("")}</span>`
              : press(item, false),
          )
          .join("")}</div><div class="rv-panel-title">${esc(panel.text)}</div></div>`,
    )
    .join("")}</div>${s.options ? `<div class="rv-options" data-modify>${s.options.map((p) => piece(p, {})).join("")}</div>` : ""}</div>`;

const press = (/** @type {RibbonButton} */ b, /** @type {boolean} */ small) =>
  `<span class="rv-rbtn"${attrs({ "data-split": b.split, "data-selected": b.selected })}><span class="rv-glyph"${attrs({ "data-size": small ? "small" : undefined })}>${esc(
    b.glyph ?? b.label.slice(0, 1),
  )}</span><span class="rv-rbtn-label">${esc(b.label)}</span></span>`;

/** @param {Spec} spec @param {RenderOptions} o */
const window_ = (spec, o) =>
  spec.t === "dialog" ? dialog(spec, o) : spec.t === "palette" ? palette(spec, o) : spec.t === "task" ? task(spec, o) : ribbon(spec);

// ── public ───────────────────────────────────────────────────────────────────────────────────

/**
 * One spec as HTML. `notes` pin numbered badges on the ids they name and list under the window;
 * `changed` rings the ids in it (`compare` fills it from `diff`).
 * @param {Spec} spec @param {RenderOptions} [o] @returns {string}
 */
const render = (spec, o = {}) => {
  if (o.notes) {
    const known = index(spec);
    for (const n of o.notes)
      if (!known.has(n.at) && !n.at.startsWith("button:") && !n.at.startsWith("group:"))
        // TODO: a live palette (fromElement) has no button row, so a note pinned to one throws here and pdrop-tour drops such notes (2026-10-05); skip or warn instead of throwing when the spec is a projection.
        throw Error(`rv: note on unknown id "${n.at}"`);
  }
  const win = window_(spec, o);
  const notes = o.notes?.length
    ? `<ol class="rv-notes">${o.notes.map((n) => `<li>${esc(n.text)}</li>`).join("")}</ol>`
    : "";
  return `<figure class="rv-figure">${win}${notes}</figure>`;
};

/** How a value reads in the legend. */
const word = (/** @type {unknown} */ v) => (v === true ? "yes" : v === false || v === undefined ? "no" : String(v));
const plain = (/** @type {string} */ id) => id.replace(/^(button|check|radio|field|label|link|group):/, "");

/**
 * The legend and the rings for a set of changes. Rows of one tree, list or grid that change the
 * same way collapse onto their container: one ring and one line ("tables: 22 rows disabled no → yes")
 * instead of a ring per row. Several changes to one piece read as one line.
 * @param {Change[]} changes
 */
const summarise = (changes) => {
  /** @type {Map<string, Change[]>} */
  const bulk = new Map();
  for (const c of changes) {
    const slash = c.at.indexOf("/");
    if (slash < 0) continue;
    const key = `${c.at.slice(0, slash)}|${c.prop}|${String(c.from)}|${String(c.to)}`;
    bulk.set(key, [...(bulk.get(key) ?? []), c]);
  }
  const collapsed = new Set([...bulk.values()].filter((g) => g.length > 3).flat());
  /** @type {Map<string, string[]>} */
  const lines = new Map();
  const add = (/** @type {string} */ at, /** @type {string} */ text) => lines.set(at, [...(lines.get(at) ?? []), text]);
  for (const g of bulk.values()) {
    if (g.length <= 3) continue;
    const c = g[0];
    const container = c.at.slice(0, c.at.indexOf("/"));
    add(
      container,
      c.prop === "added" ? `${g.length} rows appear` : c.prop === "removed" ? `${g.length} rows go` : `${g.length} rows ${c.prop} ${word(c.from)} → ${word(c.to)}`,
    );
  }
  for (const c of changes) {
    if (collapsed.has(c)) continue;
    add(c.at, c.prop === "added" ? "appears" : c.prop === "removed" ? "gone" : `${c.prop} ${word(c.from)} → ${word(c.to)}`);
  }
  return {
    rings: new Set(lines.keys()),
    legend: [...lines].map(([at, parts]) => `${plain(at)}: ${parts.join(", ")}`),
  };
};

/**
 * Two states of one window side by side: what changed is ringed on both sides and listed once,
 * notes are badged on whichever side holds their id and listed once.
 * @param {Spec} a @param {Spec} b @param {{ notes?: Note[], labels?: [string, string] }} [o] @returns {string}
 */
const compare = (a, b, o = {}) => {
  const { rings, legend } = summarise(diff(a, b));
  const [la, lb] = o.labels ?? ["before", "after"];
  const notes = o.notes ?? [];
  const side = (/** @type {Spec} */ s, /** @type {string} */ label) => {
    const known = index(s);
    // keep each note's number: badge only those whose id this side holds
    const own = notes.map((n) => (known.has(n.at) || n.at.startsWith("button:") ? n : { at: "", text: n.text }));
    return `<div class="rv-side"><div class="rv-side-label">${esc(label)}</div>${window_(s, { changed: rings, notes: own })}</div>`;
  };
  return `<div class="rv-compare"><div class="rv-sides">${side(a, la)}${side(b, lb)}</div>${
    legend.length ? `<ul class="rv-changes">${legend.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""
  }${notes.length ? `<ol class="rv-notes">${notes.map((n) => `<li>${esc(n.text)}</li>`).join("")}</ol>` : ""}</div>`;
};

// ── projections from facts ───────────────────────────────────────────────────────────────────
// A Revit window as the read says it is, so the page draws it and the agent reads the same spec.

/**
 * An element's Properties palette from one `revit.detail.elements` entry: its requested parameters
 * grouped as Revit groups them, read-only ones disabled, values as Revit displays them when the read
 * gives a display string, else the raw value. `groups` keeps only those group names, in that order.
 * @param {{ categoryName?: string | null, className: string, familyName?: string | null, typeName?: string | null,
 *   requestedParameters?: { name: string, displayValue?: string | null, rawValue?: string | null, value?: string | null,
 *   isReadOnly?: boolean | null, definition?: { groupTypeLabel?: string | null } }[] | null }} e
 * @param {{ groups?: string[] }} [o] @returns {Palette}
 */
// TODO: `revit.detail.elements` sends `definition.groupTypeId`, never `groupTypeLabel`, so every row lands under "Parameters" (pdrop-tour maps the id to the Revit label itself, 2026-10-05); take the id here.
const fromElement = (e, { groups } = {}) => {
  /** @type {Map<string, PropRow[]>} */
  const byGroup = new Map();
  for (const p of e.requestedParameters ?? []) {
    const g = p.definition?.groupTypeLabel || "Parameters";
    if (groups && !groups.includes(g)) continue;
    const rows = byGroup.get(g) ?? [];
    byGroup.set(g, rows);
    rows.push({ name: p.name, value: p.displayValue ?? p.rawValue ?? p.value ?? "", disabled: p.isReadOnly === true || undefined });
  }
  const order = groups ?? [...byGroup.keys()];
  return {
    t: "palette",
    family: e.familyName ?? e.className,
    type: e.typeName ?? "",
    instance: `${e.categoryName ?? e.className} (1)`,
    groups: order.filter((g) => byGroup.has(g)).map((g) => ({ text: g, rows: byGroup.get(g) ?? [] })),
  };
};

/**
 * A duct type's Routing Preferences dialog from rule rows `{ group, i, part, crit }` (what
 * `prefs.csx` answers: the rule group, its index, "Family : Type" and "all" or "4-12 in"): the
 * Preferred Junction Type field above one grid per group, each with its up/down/add/remove tools.
 * Grid ids are the group names, so a row is `Elbows/<part>`; a part listed twice in one group needs
 * the page to disambiguate it (rv's one-id law).
 * @param {{ group: string, i: number, part: string, crit: string }[]} rows
 * @param {{ typeName?: string, preferred?: string }} [o] @returns {Dialog}
 */
// TODO: the `row` and `tools` pieces below carry no id, so `compare` refuses the spec as duplicate ids (pdrop-tour numbers them first, 2026-10-05); give them ids per group.
const fromRouting = (rows, { typeName = "Duct Type", preferred = "Tee" } = {}) => {
  const size = (/** @type {string} */ crit) =>
    crit === "all" ? ["All", "None"] : crit.replace(/ in$/, "").split("-").map((s) => `${s} in`);
  const table = (/** @type {string} */ g) =>
    /** @type {Piece} */ ({
      t: "row",
      gap: 4,
      items: [
        { t: "tools", items: [{ icon: "up" }, { icon: "down" }, { icon: "add" }, { icon: "remove" }] },
        {
          t: "grid",
          id: g,
          grow: true,
          columns: ["Content", { text: "Minimum Size", w: 110 }, { text: "Maximum Size", w: 110 }],
          rows: rows
            .filter((r) => r.group === g)
            .sort((a, b) => a.i - b.i)
            .map((r) => ({ cells: [r.part, ...size(r.crit)] })),
        },
      ],
    });
  const groups = [...new Set(rows.map((r) => r.group))];
  return {
    t: "dialog",
    title: "Routing Preferences",
    w: 640,
    body: [
      { t: "label", text: `Duct Type: ${typeName}` },
      {
        t: "row",
        items: [
          { t: "label", text: "Preferred Junction Type:" },
          { t: "field", id: "field:Preferred Junction Type", text: preferred, drop: true, w: 160 },
        ],
      },
      ...groups.flatMap((g) => [/** @type {Piece} */ ({ t: "label", text: g }), table(g)]),
    ],
    buttons: [
      { t: "button", text: "OK", default: true },
      { t: "button", text: "Cancel" },
    ],
  };
};

/**
 * The Review Warnings dialog from warning rows `{ severity, description, elementIds }`: a tree of
 * one open row per description (prefixed with the severity when it is not a warning) with the
 * element ids as its children.
 * @param {{ severity: string, description: string, elementIds: number[] }[]} rows @returns {Dialog}
 */
const fromWarnings = (rows) => {
  /** @type {Map<string, number[]>} */
  const byText = new Map();
  for (const r of rows) {
    const text = r.severity === "Warning" ? r.description : `${r.severity}: ${r.description}`;
    byText.set(text, [...(byText.get(text) ?? []), ...r.elementIds]);
  }
  /** @type {TreeRow[]} */
  const tree = [];
  for (const [text, ids] of byText) {
    tree.push({ text, open: true });
    for (const id of ids) tree.push({ text: String(id), depth: 1 });
  }
  return {
    t: "dialog",
    title: "Warnings",
    caption: "full",
    w: 640,
    body: [
      { t: "tree", id: "warnings", rows: tree, grow: true, h: 300 },
      {
        t: "row",
        items: [
          { t: "button", text: "Show" },
          { t: "button", text: "More Info", disabled: true },
          { t: "button", text: "Delete Checked...", disabled: true },
        ],
      },
    ],
    buttons: [
      { t: "button", text: "Export..." },
      { t: "button", text: "OK", default: true },
    ],
  };
};

export { render, compare, diff, set, fromElement, fromRouting, fromWarnings };
