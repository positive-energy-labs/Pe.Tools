// A journey as data: named read actions, rules checked after every one, a seeded draw for every
// value an action needs. `run` plays a fixed list (a journey) or a seeded random walk over the
// actions whose precondition holds. Each action presses by role and visible name only, and waits
// on a condition with a deadline; rules are read from the page, never from a remembered value.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { journey, type Page } from "./cdp.ts";

export type Ctx = {
  page: Page;
  /** Draw one of `from` with the run's generator and journal it under `what`. */
  draw: <T>(what: string, from: readonly T[], label?: (t: T) => string) => T;
  /** Network evidence since the last action: bodies that failed, and requests that would mutate. */
  net: { failed: string[]; mutations: string[]; notes: string[] };
};
export type Action = {
  name: string;
  /** Read from the page: can this action run now? */
  can: (c: Ctx) => Promise<boolean>;
  /** The trusted gesture; returns the condition that shows its result on the page. */
  act: (c: Ctx) => Promise<() => Promise<boolean>>;
  /** Deadline for the result (default 60 s). */
  ms?: number;
};
/** One sentence, and a check that returns true or what it saw instead. */
export type Rule = { says: string; holds: (c: Ctx) => Promise<true | string> };

/** mulberry32: small, seedable, good enough to pick among a few dozen options. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/**
 * `node tests/e2e/<j>.ts [--seed N] [--walk N [--skip a,b]] [--steps a,b,c]`. Default: the fixed `list`.
 * The seed defaults to the commit under test (first 8 hex digits of HEAD).
 */
export async function run(
  id: string,
  actions: readonly Action[],
  rules: readonly Rule[],
  list: readonly string[],
  /** Hosts whose responses the network rules read (the product host and web origins). */
  watch: (url: string) => boolean,
) {
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const seed = Number(flag("seed") ?? parseInt(head.slice(0, 8), 16));
  const walk = Number(flag("walk") ?? 0);
  /** Actions a walk never draws, e.g. one that trips a known defect: `--skip reopenPlace`. */
  const skip = flag("skip")?.split(",") ?? [];
  const steps = flag("steps")?.split(",") ?? (walk ? null : [...list]);
  const mode = steps ? (flag("steps") ? "steps" : "journey") : `walk${walk}${skip.length ? `-skip-${skip.join("+")}` : ""}`;
  const random = rng(seed);
  const byName = new Map(actions.map((a) => [a.name, a]));
  for (const s of steps ?? []) if (!byName.has(s)) throw new Error(`unknown action ${s}`);
  process.env.E2E_LABEL ??= `${mode}-seed${seed}`;

  await journey(id, async (page, step, dir) => {
    const journal = join(dir, "steps.jsonl");
    writeFileSync(journal, "");
    mkdirSync(join(dir, "shots"), { recursive: true });
    const drawn: Record<string, string> = {};
    const net = { failed: [] as string[], mutations: [] as string[], notes: [] as string[] };
    const c: Ctx = {
      page,
      net,
      draw(what, from, label = String) {
        if (!from.length) throw new Error(`PRECONDITION: nothing to draw for ${what}`);
        const pick = from[Math.floor(random() * from.length)]!;
        drawn[what] = label(pick);
        return pick;
      },
    };
    watchNetwork(page, watch, net);
    const shot = async (name: string) => {
      const r = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(dir, "shots", `${name}.png`), Buffer.from(r.data, "base64"));
    };
    step(`seed=${seed} mode=${mode} head=${head}`);
    const total = steps?.length ?? walk;
    let errorsSeen = 0;
    const failures: string[] = [];
    for (let i = 0; i < total; i++) {
      let action: Action;
      if (steps) action = byName.get(steps[i]!)!;
      // A walk starts where a person does, at its first journey step: never on a page the last run left.
      else if (i === 0) action = byName.get(list[0]!)!;
      else {
        const ready: Action[] = [];
        for (const a of actions)
          if (!skip.includes(a.name) && (await a.can(c).catch(() => false))) ready.push(a);
        action = c.draw(`step${i}`, ready, (a) => a.name);
      }
      for (const k of Object.keys(drawn)) delete drawn[k];
      net.failed.length = net.mutations.length = net.notes.length = 0;
      const t0 = Date.now();
      const results: Record<string, true | string> = {};
      try {
        if (!(await action.can(c))) throw new Error("its precondition does not hold");
        const done = await action.act(c);
        await page.until(done, `${action.name} to settle`, action.ms ?? 60_000);
      } catch (error) {
        // The action itself failed: no rule ran on a page it left half-done.
        results["The action settles."] = error instanceof Error ? error.message : String(error);
      }
      const ms = Date.now() - t0;
      if (!("The action settles." in results))
        for (const r of rules) results[r.says] = await r.holds(c).catch((e) => `rule threw: ${e}`);
      if (page.errors.length > errorsSeen)
        results["No uncaught page exception."] = page.errors.slice(errorsSeen).join(" | ");
      errorsSeen = page.errors.length;
      const broken = Object.entries(results).filter(([, v]) => v !== true);
      appendFileSync(
        journal,
        JSON.stringify({ i, action: action.name, drawn: { ...drawn }, ms, rules: results, notes: [...net.notes] }) + "\n",
      );
      step(`${i} ${action.name} ${JSON.stringify(drawn)} ${ms}ms${broken.length ? " RULE FAIL" : ""}`);
      if (broken.length) {
        await shot(`step${i}-${action.name}`);
        failures.push(...broken.map(([says, saw]) => `step ${i} ${action.name}: ${says} saw: ${saw}`));
        // A broken rule is evidence and the walk goes on; a failed action leaves no page to read.
        if ("The action settles." in results) break;
      }
    }
    await shot("final");
    writeFileSync(join(dir, "errors.json"), JSON.stringify(page.errors, null, 2));
    if (failures.length) throw new Error(`ASSERT seed=${seed}: ${failures.join("; ")}`);
    step(`seed=${seed} ${mode} PASS`);
  });
}

/** Bodies with a failed status or a failed shape, and non-read requests, on the watched hosts. */
function watchNetwork(page: Page, watch: (url: string) => boolean, net: Ctx["net"]) {
  const pending = new Map<string, { url: string; status: number; method: string }>();
  const methods = new Map<string, string>();
  page.onEvent((e) => {
    if (e.sessionId) return;
    if (e.method === "Network.requestWillBeSent") {
      const r = e.params.request;
      methods.set(e.params.requestId, r.method);
      if (watch(r.url) && !["GET", "HEAD", "OPTIONS"].includes(r.method) && MUTATES.test(r.url))
        net.mutations.push(`${r.method} ${r.url}`);
    }
    if (e.method === "Network.responseReceived" && watch(e.params.response.url))
      pending.set(e.params.requestId, { url: e.params.response.url, status: e.params.response.status, method: methods.get(e.params.requestId) ?? "GET" });
    if (e.method === "Network.loadingFinished") {
      const r = pending.get(e.params.requestId);
      if (!r) return;
      pending.delete(e.params.requestId);
      // Reads only: a failed write is a note (the write rule owns writes), not a read rendered as success.
      const into = r.method === "GET" ? net.failed : net.notes;
      if (r.status >= 400) return void into.push(`${r.method} ${r.status} ${r.url}`);
      page
        .send("Network.getResponseBody", { requestId: e.params.requestId })
        .then((b: { body: string }) => {
          const why = failedBody(b.body);
          if (why) into.push(`${r.method} ${r.url}: ${why}`);
        })
        .catch(() => {});
    }
    if (e.method === "Network.webSocketFrameReceived") {
      const why = failedBody(e.params.response.payloadData);
      if (why) net.failed.push(`ws: ${why}`);
    }
    if (e.method === "Network.webSocketFrameSent" && MUTATES_FRAME.test(e.params.response.payloadData))
      net.mutations.push(`ws: ${e.params.response.payloadData.slice(0, 200)}`);
  });
}

// ponytail: name-based guesses at the host's write doors; tighten when a write shape changes.
const MUTATES = /\/(work|stage|plan|write|apply|edit)s?\b/i;
const MUTATES_FRAME = /"(stage|plan|write|apply)[A-Z"]/;

/** A JSON body that reports failure in its own shape: ok:false, an error, or a failed outcome. */
function failedBody(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.ok === false) return `ok:false ${JSON.stringify(b.error ?? b.reason ?? "").slice(0, 200)}`;
  if (b.error && typeof b.error === "object") return `error ${JSON.stringify(b.error).slice(0, 200)}`;
  if (b.outcome === "failed" || b.status === "failed") return `failed ${text.slice(0, 200)}`;
  return null;
}
