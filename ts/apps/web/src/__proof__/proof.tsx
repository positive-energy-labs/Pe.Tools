// Scratch proof page for crusade/kernel-wave1-polish2. Never committed.
import "../styles.css";
import "#/workbench/lens.css";
import { createRoot } from "react-dom/client";
import { useState, type ReactNode } from "react";
import { KeyScopeHost } from "@pe/kit/keys";
import { Accordion } from "@pe/kit/lang/accordion";
import { List } from "@pe/kit/lang/list-popup";
import { Pane } from "@pe/kit/lang/pane";
import { emptyTableState } from "@pe/kit/table/view";
import { TypeGrid } from "#/families/pivot-grid";
import { RouteTabs, RouteTabActions } from "#/workbench/route-tabs";
import { documentColumns, ModelTable } from "#/open/documents";
import { extra } from "./extra";

const W = window as any;
const q = (s: string) => document.querySelector(s) as HTMLElement | null;
const qa = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const cs = (el: Element | null, p: string) => (el ? getComputedStyle(el).getPropertyValue(p) : null);
const rect = (el: Element | null) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};
const cut = (el: Element) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1;
const lines = (el: Element) => {
  const r = document.createRange();
  const out = new Set<number>();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    r.selectNodeContents(n);
    for (const b of Array.from(r.getClientRects())) if (b.width > 0) out.add(Math.round(b.top));
  }
  return out.size;
};
export const h = { q, qa, cs, rect, cut, lines };
export const measures: Record<string, () => unknown> = {};
export const acts: (() => Promise<void> | void)[] = [];
export const readies: (() => boolean)[] = [];
W.__measure = () =>
  Object.fromEntries(
    Object.entries(measures).map(([k, f]) => {
      try {
        return [k, f()];
      } catch (e) {
        return [k, "ERR " + String(e)];
      }
    }),
  );
W.__act = async () => {
  for (const a of acts) await a();
};
export const box = (id: string, w: number, hgt: number | undefined, child: ReactNode) => (
  <section
    key={id}
    id={id}
    style={{ width: w, height: hgt, margin: 8, outline: "1px dashed var(--pe-line)", display: "flex", flexDirection: "column", overflow: "hidden" }}
  >
    {child}
  </section>
);

measures.accordion = () =>
  qa("#acc button[aria-expanded]").map((x) => ({ text: x.textContent?.slice(0, 12), expanded: x.getAttribute("aria-expanded"), bg: cs(x, "background-color") }));
measures.matrix = () => ({
  head: cs(q("#grid [role=columnheader]"), "background-color"),
  rowhead: cs(q("#grid [role=rowheader]"), "background-color"),
  cell: cs(q("#grid [role=grid]"), "background-color"),
});
measures.select = () => {
  const sel = q("#sel [aria-selected=true]");
  const cur = q("#sel .dl-row[data-cursor]");
  return {
    selBg: cs(sel, "background-color"),
    selOutline: `${cs(sel, "outline-color")} ${cs(sel, "outline-width")} ${cs(sel, "outline-style")}`,
    curBg: cs(cur, "background-color"),
    curOutline: cs(cur, "outline-style"),
  };
};
measures.tabs = () => {
  const labels = qa("#tabs [data-slot=route-tabs] span.truncate");
  const gaps = labels.slice(1).map((l, i) => Math.round(l.getBoundingClientRect().left - labels[i]!.getBoundingClientRect().right));
  return {
    n: labels.length,
    full: labels.filter((l) => !cut(l)).length,
    widths: labels.map((l) => Math.round(l.getBoundingClientRect().width)),
    minGap: Math.min(...gaps),
    status: q("#tabs [role=status]")?.textContent?.slice(0, 50) ?? null,
    statusW: rect(q("#tabs [role=status]"))?.w ?? null,
  };
};
measures.docs = () => {
  const heads = qa("#docs th").map((th) => ({ t: th.textContent?.trim().slice(0, 12), w: rect(th)!.w }));
  const r1 = qa("#docs tbody tr")[0];
  const cells = r1
    ? Array.from(r1.children).map((td) => ({ t: (td.textContent ?? "").slice(0, 18), w: rect(td)!.w, cut: cut((td.firstElementChild ?? td) as Element) }))
    : [];
  return { heads, cells, table: rect(q("#docs table")) };
};

const ROUTES = ["fans", "ducts", "families", "fans", "home", "duct-loss", "family", "captures", "design-system", "pods", "rooms", "schedules"];
const placeTabs = ROUTES.map((route, i) => ({ id: `t${i}`, route, link: `/${route}` })) as never;

const docRows = Array.from({ length: 6 }, (_, i) => ({
  key: `d${i}`,
  title: `Chadds Residential Model ${i} - Mechanical`,
  path: i % 2 ? `C:\\Projects\\Chadds\\Model${i}.rvt` : `cld://autodesk/proj/Model${i}.rvt`,
  selector: "x",
  cloud: i % 2 === 0,
  savedYear: i % 3 ? 2023 : null,
  savedYearFailure: i % 3 ? null : "not read",
  lastYear: 2025,
  openIn: null,
}));
function Docs() {
  const [state, setState] = useState(emptyTableState());
  return (
    <div className="flex max-h-72 min-w-0 shrink-0 flex-col pr-6 [&_table]:table-fixed [&_[data-slot=table-filters]]:gap-y-1 [&_[data-slot=query-box]]:basis-full [&_[data-slot=query-box]]:flex-none [&_span[role=group]]:max-w-full [&_span[role=group]]:flex-wrap">
      <ModelTable rows={docRows as never} columns={documentColumns("stack")} state={state} onStateChange={setState} picked={null} onPick={() => {}} loading={false} />
    </div>
  );
}

const items = ["Air Terminal Tags", "Air Terminals", "Area Tags", "Balusters", "Cable Tray Tags"].map((name) => ({ key: name, name }));
const param = (key: string) => ({ key, name: key, kind: "FamilyParameter", isInstance: false, isBuiltIn: false, isProjectOnly: false, familyCount: 1 });
const params = ["Actual Supply Air Flow", "Blade Deflection", "Border Type"].map(param);
const scopes = Object.fromEntries(params.map((p) => [p.key, "Family"]));
const types = ["RCDE Size 6", "12X24", "2.5X48"].map((t, i) => ({
  key: `A:${t}`,
  familyId: 1,
  familyName: i ? "Custom Grd" : "Ceiling Diffuser",
  categoryName: "Air Terminals",
  typeName: t,
  typeCount: 1,
  values: Object.fromEntries(params.map((p) => [p.key, "0 CFM"])),
  scopes,
  formulas: {},
  storageTypes: Object.fromEntries(params.map((p) => [p.key, "String"])),
}));
const pivotRows = params.map((p) => ({ key: p.key, name: p.name, kind: p.kind, families: 1, filled: 3, present: 3, filledByFamily: {} }));
const live = {
  cells: {},
  at: () => ({ owner: { route: "families", label: "Work" }, value: {}, refusal: null, transitions: () => [], stage: async () => null, clear: async () => null }),
  listeners: new Set(),
};

readies.push(() => !!q("#docs table") && !!q("#grid [role=grid]"));
W.__ready = () => readies.every((r) => r());
createRoot(document.getElementById("root")!).render(
  <KeyScopeHost id="proof">
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start" }}>
      {box(
        "acc",
        650,
        undefined,
        <Accordion
          label="settings"
          open="share"
          onOpen={() => {}}
          groups={[
            { key: "revit", label: "Revit", state: "2 running", body: null },
            { key: "share", label: "Share", state: "refused", tone: "caution", body: <p>Share over tailnet</p> },
            { key: "update", label: "Update", state: "unread", body: null },
          ] as never}
        />,
      )}
      {box(
        "grid",
        680,
        220,
        <TypeGrid
          rows={pivotRows as never}
          types={types as never}
          families={[{ familyId: 1, familyUniqueId: "a", name: "Ceiling Diffuser", category: "Air Terminals", types: 3, placed: 1, params: 3 }] as never}
          edit={{ params: new Map(params.map((p) => [p.key, p])), live, propose: async () => null, readOnly: false } as never}
          scroller={{ current: null }}
        />,
      )}
      {box(
        "sel",
        300,
        undefined,
        <List aria-label="sel" items={items} keyOf={(i) => i.key} labelOf={(i) => i.name} select="single" selected={["Air Terminals"]} cursor="Balusters" empty="none" row={(i) => ({ label: i.name })} />,
      )}
      {box(
        "tabs",
        690,
        undefined,
        <Pane
          title="tools"
          tabs={<RouteTabs tabs={placeTabs} active="t2" onSelect={() => {}} onClose={() => {}} />}
          actions={
            <RouteTabActions
              tabs={[] as never}
              active="t2"
              failure="This window keeps 12 Places; close one first."
              onRetry={() => {}}
              onChat={() => {}}
              onDuplicate={() => {}}
              onCloseActive={() => {}}
            />
          }
        >
          <p>body</p>
        </Pane>,
      )}
      {box("docs", 690, 360, <Docs />)}
      {extra()}
    </div>
  </KeyScopeHost>,
);
