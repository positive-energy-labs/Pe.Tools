import { readFile } from "node:fs/promises";
import { expect, test } from "vite-plus/test";

test.each(["openId", "session"] as const)(
  "review: Hydronic refuses a read assembled across a Page %s rebind",
  async (field) => {
    const html = await readFile(
      new URL("../../../../examples/pods/hydronic/pages/sizing/index.html", import.meta.url),
      "utf8",
    );
    const script = /<script type="module">([\s\S]*?)<\/script>/
      .exec(html)![1]!
      .replace(/^import .*;$/m, "const { fromRevit, size } = __math;");
    const original = { session: "s", openId: "A", title: "Model A" };
    let current = original;
    const events: any[] = [];
    const readTargets: string[] = [];
    const refusals: string[] = [];
    const state: any = {
      reading: null,
      chosen: {},
      limits: { maxVelocity: 1.5, maxFriction: 400 },
    };
    const pe = {
      kitReady: Promise.resolve(),
      kit: {
        h: () => ({}),
        createRoot: () => ({ render() {} }),
        React: {},
        Button: "Button",
        Input: "Input",
        Code: "Code",
      },
      state: async () => ({
        state,
        fire: async (event: any) => {
          events.push(event);
          state.reading = event.reading;
        },
      }),
      target: async () => current,
      refuse: (message: string) => refusals.push(message),
      read: async (key: string, input: any) => {
        readTargets.push(current.openId);
        if (key === "mep.system.members" && !input.systemUniqueId) {
          current = { ...original, [field]: "B", title: "Model B" };
          return { systems: [{ domain: "piping", uniqueId: "system-in-A" }] };
        }
        return key === "mep.system.members"
          ? { systemUniqueId: input.systemUniqueId, from: "B" }
          : { segments: [], from: "B" };
      },
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const page = await new AsyncFunction("pe", "document", "__math", script + "\nreturn {read};")(
      pe,
      { getElementById: () => ({}) },
      {
        fromRevit: () => ({ pipes: [], catalogs: {}, rooted: true }),
        size: () => ({ rows: [], unresolved: [], pumpHead: { pa: null } }),
      },
    );
    const outcome = await page.read().then(
      () => null,
      (error: any) => error,
    );
    expect(readTargets).toEqual(field === "openId" ? ["A", "B", "B"] : ["A", "A", "A"]);
    console.log(
      "published",
      events.map((e) => ({ target: e.reading.target, system: e.reading.system })),
      "native read targets",
      readTargets,
    );
    expect(events).toHaveLength(0);
    expect(outcome).toBeInstanceOf(Error);
    expect(refusals).toEqual([outcome.message]);
  },
);
