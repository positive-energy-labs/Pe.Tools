import { describe, expect, test, vi } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { entityRoute, type EntityRouteDef, type PlanEntry } from "./entity-route";
import { admissionPlan } from "./workflow";

const SCHEMA = "/schemas/settings/Demo/demo.json";
const ROW: PlanEntry = {
  id: "a",
  name: "a",
  actions: 1,
  detail: "",
  flag: null,
  warnings: [],
  plan: "sealed-preview",
};

function route(entries: readonly PlanEntry[] = [ROW]) {
  const read = vi.fn(async () => ({ entries }));
  const apply = vi.fn(async () => {});
  const direct = vi.fn(async () => {});
  const def: EntityRouteDef<unknown, never, object> = {
    key: "family",
    name: "Demo",
    entity: "demo",
    schema: SCHEMA,
    apply: "family.apply",
    plan: { read, apply, direct },
  };
  const manifest = entityRoute(def, {
    address: "family",
    page: routeAddress("family").schema as never,
  });
  const ctx = {
    page: {
      ...routeAddress("family").defaults,
      stage: "apply",
      pod: "p",
      path: "a.json",
      confirming: false,
      sheet: null as { entries: readonly PlanEntry[] } | null,
    },
    readings: {
      pods: {
        state: "ready",
        observation: [{ id: "p", members: [{ path: "a.json", schema: SCHEMA, sha256: "s" }] }],
      },
    },
    work: { key: { route: "family" }, doc: null, revision: null, refusal: null },
    setPage: vi.fn((patch) => Object.assign(ctx.page, patch)),
    note: vi.fn(),
  };
  return {
    run: () => manifest.actions!.apply.run(ctx as never, undefined as never),
    preview: () => manifest.actions!.preview.run(ctx as never, undefined as never),
    ready: () => manifest.actions!.apply.ready!(ctx as never, undefined as never),
    read,
    direct,
    apply,
    ctx,
  };
}

describe("host semantic Apply and optional Preview", () => {
  test("one press invokes the host once without a browser planning round trip", async () => {
    const { run, read, direct, apply, ctx } = route();
    expect(await run()).toBeNull();
    expect(direct).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      pod: "p",
      path: "a.json",
      sha256: "s",
    });
    expect(read).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(ctx.setPage).not.toHaveBeenCalled();
  });

  test("Preview opens sealed rows, and Apply names only that reviewed preview", async () => {
    const { preview, run, read, direct, apply, ctx } = route();
    await preview();
    expect(read).toHaveBeenCalledOnce();
    expect(direct).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(ctx.page.sheet).toEqual({ entries: [ROW] });
    expect(await run()).toBeNull();
    expect(apply).toHaveBeenCalledExactlyOnceWith(expect.anything(), [ROW], {
      pod: "p",
      path: "a.json",
      sha256: "s",
    });
    expect(direct).not.toHaveBeenCalled();
    expect(ctx.page.sheet).toBeNull();
  });

  test("a preview with no applicable rows refuses Apply without a command", async () => {
    const { preview, ready, direct, apply } = route([{ ...ROW, flag: "refused by plan" }]);
    await preview();
    expect(ready()).toBe("no included row has changes to apply");
    expect(direct).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  test("a preview invocation fits the host's strict command input", async () => {
    const { commands } = await import("@pe/agent-contracts");
    const apply = vi.fn(async (input) => {
      commands["families.apply"].input.parse(input);
      return { state: "succeeded", result: {} };
    });
    const plan = admissionPlan({ plan: "families.plan", apply: "families.apply" }, () => ROW);
    await plan.apply({ commands: { "families.apply": apply } } as never, [ROW], {
      pod: "p",
      path: "a.json",
      sha256: "s",
    });
    expect(apply).toHaveBeenCalledWith({
      plan: "sealed-preview",
      include: ["a"],
    });
  });
});
