// F1 · Find and explain a fan, /fans, reads only. Prose: drive/JOURNEYS.md F1.
//   node tests/e2e/f1-fans.ts [--seed N] [--walk 30] [--steps open,selectFan,...]
// Env: CDP_PORT, CDP_TARGET (own browser), E2E_WEB, E2E_SESSION (the run's controlled session id;
// the document picker offers only options in it).
import { WEB, type Page } from "./cdp.ts";
import { run, type Action, type Rule } from "./walk.ts";

/** A region by its accessible name: the scope a press may use. */
const R = (name: string) => `[aria-label="${name}"]`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the shown /fans Place draws, read in one pass. Hidden Places keep DOM; only shown nodes count. */
type View = {
  url: string;
  busy: boolean;
  /** The route asks for a document: settled, with nothing to read yet. */
  unbound: boolean;
  picker: boolean;
  rows: { label: string; selected: boolean }[];
  heading: string | null;
  tab: string | null;
  fanIds: string[];
  zeros: string[];
  unitless: string[];
  alerts: string[];
  places: number;
};
const view = (page: Page) =>
  page.evaluate((): View => {
    const shown = (e: Element) =>
      e.getClientRects().length > 0 && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const first = (sel: string) => [...document.querySelectorAll(sel)].find(shown) ?? null;
    const text = (e: Element | null) => ((e as HTMLElement | null)?.innerText ?? "").trim();
    const tools = first('[aria-label="tools"]');
    const roster = first('[role="listbox"][aria-label="fans"]');
    const rows = [...(roster?.querySelectorAll('[role="option"]') ?? [])].map((o) => ({
      label: /^(.*? \/ port \d+)/.exec(text(o))?.[1] ?? text(o),
      selected: o.getAttribute("aria-selected") === "true",
    }));
    const esp = first('[aria-label="Required ESP"]');
    const fan = new URL(location.href).searchParams.get("fan");
    let fanIds: string[] = [];
    try {
      fanIds = fan ? (JSON.parse(fan).ids as string[]) : [];
    } catch {
      fanIds = ["unparsable"];
    }
    // Worksheet rows: run to · cfm · TEL · loss · resid. · fpm. A run whose cfm is missing has no loss.
    const zeros = [...document.querySelectorAll('[aria-label$="worksheet"] [role="row"]')]
      .filter(shown)
      .map((r) => [...r.children].map((c) => text(c)))
      .filter((cells) => cells.some((c) => /incomplete/.test(c)) && cells.includes("—") && cells.some((c) => /^0(\.0+)?$/.test(c)))
      .map((cells) => cells.join(" | "));
    // Every value cell (named "<label> <unit>") draws its unit beside the input and its source last.
    const cells = [...(first('[aria-label="Sheet inputs"]')?.querySelectorAll("input") ?? [])]
      .filter(shown)
      .map((i) => {
        const cell = i.closest("[aria-label]");
        return {
          name: cell?.getAttribute("aria-label") ?? "?",
          value: i.value.trim(),
          unit: text(i.nextElementSibling?.firstElementChild ?? null),
          source: text(cell?.lastElementChild ?? null),
        };
      });
    const unitless = cells
      .filter((c) => !c.unit || !c.source)
      .map((c) => `${c.name}: unit "${c.unit}" source "${c.source}"`);
    zeros.push(
      ...cells
        .filter((c) => c.source === "none" && /^0(\.0+)?$/.test(c.value))
        .map((c) => `${c.name} = ${c.value} with source none`),
    );
    const places = [...document.querySelectorAll('[aria-label="Places"] button')]
      .filter((b) => !(b.getAttribute("aria-label") ?? "").startsWith("Close "));
    return {
      url: location.href,
      busy: /computing|Loading drawing|Reading\.\.\.|reading…|refreshing/i.test(text(tools) + text(first('[aria-label="Situation"]'))),
      unbound: /choose an exact document again/i.test(text(tools)),
      picker: [...document.querySelectorAll('[role="option"]')].some((o) => shown(o) && !tools?.contains(o)),
      rows,
      heading: esp ? text(esp.querySelector("h3")) : null,
      tab: text(places.find((b) => b.getAttribute("aria-pressed") === "true") ?? null) || null,
      fanIds,
      zeros,
      unitless,
      alerts: [...(tools?.querySelectorAll('[role="alert"],[data-tone="caution"]') ?? [])].filter(shown).map((e) => text(e)),
      places: places.length,
    };
  });

const picked = (v: View) => v.rows.filter((r) => r.selected);
/** "FC-23 · Level 1/Main Level / port 1" → { mark: "FC-23", port: "1" }; the heading draws mark · port. */
const part = (label: string) => {
  const m = /^(.*?)(?: · .*)? \/ port (\d+)$/.exec(label);
  return { mark: m?.[1] ?? label, port: m?.[2] ?? "?" };
};
const idle = async (page: Page) => {
  const v = await view(page);
  return !v.busy && !v.picker && (v.rows.length > 0 || v.unbound) ? v : null;
};
/** Rules read a settled page: wait for one, with a deadline, never pass a page mid-read. */
const quiet = (page: Page) => page.until(() => idle(page), "a settled page for the rules", 120_000);
const settledOn = (page: Page, label: string | null) => async () => {
  const v = await idle(page);
  if (!v) return false;
  const sel = picked(v).map((r) => r.label);
  return label === null ? sel.length === 0 : sel.length === 1 && sel[0] === label && v.heading !== null;
};
const option = (label: string) => ({ role: "option", name: new RegExp(`^${esc(label)}`), within: R("fans") });
async function press(page: Page, target: Parameters<Page["gestures"]["click"]>[0]) {
  const r = await page.gestures.click(target);
  if (r.outcome !== "done") throw new Error(`ASSERT press ${JSON.stringify(target, (_, v) => (v instanceof RegExp ? String(v) : v))}: ${JSON.stringify(r)}`);
}
async function history(page: Page, delta: number) {
  const h = await page.send("Page.getNavigationHistory");
  // Browser Back/Forward: the page draws no control for it, so the browser's own history entry is the gesture.
  await page.send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex + delta].id });
}

const actions: Action[] = [
  {
    name: "open",
    can: async () => true,
    async act({ page }) {
      await page.open(`${WEB}/fans`);
      return async () => !!(await idle(page));
    },
    ms: 300_000, // a cold roster read: 60 s idle, longer while the host serves another tab
  },
  {
    name: "pickDocument",
    can: async ({ page }) => (await page.has("Choose a document", R("Situation"))) && !(await view(page)).picker,
    async act(c) {
      const { page } = c;
      await press(page, { role: "button", name: "Choose a document", within: R("Situation") });
      const session = process.env.E2E_SESSION ?? "";
      // Only documents in this run's own session: the disposable copy, never the owner's.
      const docs = await page.until(async () => {
        const all = await page.evaluate(() =>
          [...document.querySelectorAll('[role="option"]')]
            .filter((o) => o.getClientRects().length && !o.closest('[aria-label="tools"]'))
            .map((o) => (o as HTMLElement).innerText.trim()),
        );
        const own = all.filter((t) => session && t.split("\n").includes(session));
        return own.length ? own : null;
      }, `a document in session ${session}`);
      const doc = c.draw("document", docs, (d) => d.replace("\n", " · "));
      await press(page, { role: "option", name: new RegExp(`^${esc(doc.split("\n")[0]!)}\\s+${esc(session)}$`) });
      return async () => !!(await idle(page)) && new URL(await page.url()).searchParams.has("target");
    },
    ms: 180_000,
  },
  {
    name: "selectFan",
    can: async ({ page }) => !!(await idle(page))?.rows.length,
    async act(c) {
      // A Place restores its last fans; start from none, through the roster's own Clear.
      if (picked(await view(c.page)).length) {
        await press(c.page, { role: "button", name: "Clear fans", within: R("fans") });
        await c.page.until(settledOn(c.page, null), "the roster to clear", 60_000);
      }
      const v = await view(c.page);
      const marks = [...new Set(v.rows.map((r) => part(r.label).mark))];
      const mark = c.draw("fan", marks);
      const port = c.draw("port", v.rows.filter((r) => part(r.label).mark === mark), (r) => r.label);
      await press(c.page, option(port.label));
      return settledOn(c.page, port.label);
    },
    ms: 240_000,
  },
  {
    name: "switchFan",
    can: async ({ page }) => { const v = await idle(page); return !!v && picked(v).length === 1; },
    async act(c) {
      const v = await view(c.page);
      const current = picked(v)[0]!.label;
      // Pressing the open row closes it; then open another.
      await press(c.page, option(current));
      await c.page.until(settledOn(c.page, null), "the open fan to close", 60_000);
      const others = v.rows.filter((r) => part(r.label).mark !== part(current).mark);
      const next = c.draw("fan", others, (r) => r.label);
      await press(c.page, option(next.label));
      return settledOn(c.page, next.label);
    },
    ms: 240_000,
  },
  {
    name: "clearFans",
    can: async ({ page }) => { const v = await idle(page); return !!v && picked(v).length > 0; },
    async act({ page }) {
      await press(page, { role: "button", name: "Clear fans", within: R("fans") });
      return settledOn(page, null);
    },
  },
  {
    name: "readInputs",
    can: async ({ page }) => { const v = await idle(page); return !!v && picked(v).length === 1 && (await page.has(/^Show the \d+ fittings$/, R("Inputs"))); },
    async act(c) {
      // A read: what the Inputs pane names for this fan, journaled through the draw record.
      const counts = await c.page.evaluate(() => {
        const s = [...document.querySelectorAll('[aria-label="Sheet inputs"]')].find((e) => e.getClientRects().length);
        return { inputs: s?.querySelectorAll("input").length ?? 0, sources: (s as HTMLElement | undefined)?.innerText.match(/· from \/\w+/g)?.length ?? 0 };
      });
      c.draw("inputs", [`${counts.inputs} values, ${counts.sources} sourced`]);
      return async () => true;
    },
  },
  {
    name: "readLedger",
    can: async ({ page }) => { const v = await idle(page); return !!v && picked(v).length === 1 && v.heading !== null; },
    async act(c) {
      const ledger = await c.page.evaluate(() => {
        const e = [...document.querySelectorAll('[aria-label="Required ESP"]')].find((n) => n.getClientRects().length) as HTMLElement | undefined;
        const taken = [...document.querySelectorAll('[aria-label="Taken assumptions"]')].find((n) => n.getClientRects().length) as HTMLElement | undefined;
        return `${(e?.innerText ?? "").replace(/\s+/g, " ").slice(0, 200)} | taken: ${(taken?.innerText ?? "").replace(/\s+/g, " ").slice(0, 80)}`;
      });
      c.draw("ledger", [ledger]);
      return async () => true;
    },
  },
  {
    name: "explainFitting",
    can: async ({ page }) => { const v = await idle(page); return !!v && picked(v).length === 1 && (await page.has(/^(Show|Hide) the \d+ fittings$/, R("Inputs"))); },
    async act(c) {
      const names = await c.page.evaluate(() =>
        [...new Set([...document.querySelectorAll('[aria-label="Inputs"] button')]
          .filter((b) => b.getClientRects().length)
          .map((b) => b.getAttribute("aria-label") ?? "")
          .filter((n) => /^(Show|Hide) the \d+ fittings$/.test(n)))],
      );
      const name = c.draw("fitting", names);
      const after = name.replace(/^(Show|Hide)/, (w) => (w === "Show" ? "Hide" : "Show"));
      await press(c.page, { role: "button", name, within: R("Inputs") });
      return async () => (await c.page.has(after, R("Inputs"))) && !!(await idle(c.page));
    },
  },
  {
    name: "back",
    can: async ({ page }) => !!(await idle(page)) && (await page.send("Page.getNavigationHistory")).currentIndex > 0,
    async act({ page }) {
      const before = await page.url();
      await history(page, -1);
      return async () => (await page.url()) !== before && !!(await idle(page));
    },
    ms: 240_000,
  },
  {
    name: "forward",
    can: async ({ page }) => {
      const h = await page.send("Page.getNavigationHistory");
      return !!(await idle(page)) && h.currentIndex < h.entries.length - 1;
    },
    async act({ page }) {
      const before = await page.url();
      await history(page, 1);
      return async () => (await page.url()) !== before && !!(await idle(page));
    },
    ms: 240_000,
  },
  {
    name: "reload",
    can: async ({ page }) => !!(await idle(page)),
    async act({ page }) {
      await page.reload();
      return async () => !!(await idle(page));
    },
    ms: 240_000,
  },
  {
    name: "reopenPlace",
    can: async ({ page }) => { const v = await idle(page); return !!v && v.places === 1; },
    async act({ page }) {
      const tab = (await view(page)).tab!;
      await press(page, { role: "button", name: "Open another Place on this route", within: R("tools") });
      await page.until(async () => (await view(page)).places === 2, "a second Place");
      // The close control shows on hover only; close the older Place (the one not pressed).
      const older = { role: "button", name: tab, within: R("Places") };
      const hovered = await page.gestures.hover(older);
      if (hovered.outcome !== "done") throw new Error(`ASSERT hover ${tab}: ${JSON.stringify(hovered)}`);
      await press(page, { role: "button", name: `Close ${tab}`, within: R("Places") });
      return async () => { const v = await idle(page); return !!v && v.places === 1; };
    },
    ms: 240_000,
  },
];

const rules: Rule[] = [
  {
    says: "The detail names the fan that was selected.",
    async holds({ page }) {
      const v = await quiet(page);
      const sel = picked(v);
      if (sel.length !== 1) return v.heading === null || `heading "${v.heading}" with ${sel.length} rows selected`;
      const { mark, port } = part(sel[0]!.label);
      return v.heading === `${mark} · port ${port}` || `selected "${sel[0]!.label}", heading "${v.heading}"`;
    },
  },
  {
    says: "The URL names one document, and its fans agree with the roster selection and the Place tab.",
    async holds({ page }) {
      const v = await quiet(page);
      const sel = picked(v).map((r) => r.label);
      const ports = v.fanIds.map((id) => /@(\d+)"?\]?$/.exec(id)?.[1] ?? "?").sort();
      const want = sel.map((l) => part(l).port).sort();
      if (ports.join() !== want.join()) return `URL fan ports [${ports}] vs selected [${sel}]`;
      const target = new URL(v.url).searchParams.get("target");
      let doc: unknown = null;
      try {
        doc = target === null ? null : JSON.parse(target);
      } catch {
        doc = "unparsable";
      }
      // The target names one document as an object; a string here is a target encoded twice.
      if (target !== null && (typeof doc !== "object" || doc === null)) return `URL target is ${JSON.stringify(target).slice(0, 80)}`;
      const tab = sel.length ? `Fans · ${sel.join(", ")}` : "Fans";
      return v.tab === tab || `tab "${v.tab}" vs selected [${sel}]`;
    },
  },
  {
    says: "No number is shown as a bare zero where the page marks its data missing.",
    async holds({ page }) {
      const v = await quiet(page);
      return v.zeros.length === 0 || v.zeros.slice(0, 3).join(" ;; ");
    },
  },
  {
    says: "Every input names its unit and its source.",
    async holds({ page }) {
      const v = await quiet(page);
      return v.unitless.length === 0 || v.unitless.slice(0, 3).join(" ;; ");
    },
  },
  {
    says: "No response with a failed body is rendered as success.",
    async holds({ page, net }) {
      if (!net.failed.length) return true;
      const v = await view(page);
      return v.alerts.length > 0 || `failed: ${net.failed.slice(0, 2).join(" ;; ")}; page shows no alert`;
    },
  },
  {
    says: "No action stages Work, plans or writes.",
    async holds({ net }) {
      return net.mutations.length === 0 || net.mutations.slice(0, 2).join(" ;; ");
    },
  },
];

const F1 = [
  "open",
  "pickDocument", // select only the disposable copy through the Situation
  "selectFan", // find a fan by its visible name; choose an actual port
  "readInputs", // Inputs: units, flow sources
  "readLedger", // Goal/loss ledger, unresolved assumptions
  "explainFitting", // a fitting/source explanation
  "switchFan", // switch to another fan
  "back", // and return
  "forward",
  "back",
  "reopenPlace", // reopen a pane
];

const host = new URL(WEB).host;
await run("F1-fans", actions, rules, F1, (url) => {
  const u = new URL(url);
  return (u.host === host || u.hostname === "127.0.0.1") && !/\.(js|ts|tsx|css|svg|png|woff2?)$|^\/(@|node_modules|src)\//.test(u.pathname);
});
