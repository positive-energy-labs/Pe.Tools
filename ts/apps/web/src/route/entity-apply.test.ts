import { describe, expect, test, vi } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { entityRoute, type EntityRouteDef, type PlanEntry } from "./entity-route";

const SCHEMA = "/schemas/settings/Demo/demo.json";
const ROW: PlanEntry = {
  id: "a",
  name: "a",
  planHash: "h",
  actions: 1,
  detail: "",
  flag: null,
  warnings: [],
};

/** An entity route over a saved spec whose plan lane is `read`/`apply` alone: no host reach. */
function route(confirm: boolean, entries: readonly PlanEntry[] = [ROW], composed = false) {
  const read = vi.fn(async () => ({ entries }));
  const apply = vi.fn(async () => {});
  const direct = vi.fn(async () => {});
  const def: EntityRouteDef<unknown, never, object> = {
    key: "family",
    name: "Demo",
    entity: "demo",
    schema: SCHEMA,
    apply: "family.apply",
    plan: {
      read,
      apply,
      ...(composed ? { direct } : {}),
      ...(confirm ? { confirm: true as const } : {}),
    },
  };
  const manifest = entityRoute(def, {
    address: "family",
    page: routeAddress("family").schema as never,
  });
  const setPage = vi.fn();
  const ctx = {
    page: {
      ...routeAddress("family").defaults,
      stage: "apply",
      pod: "p",
      path: "a.json",
      confirming: false,
      sheet: null,
    },
    readings: {
      pods: {
        state: "ready",
        observation: [{ id: "p", members: [{ path: "a.json", schema: SCHEMA, sha256: "s" }] }],
      },
    },
    work: { key: { route: "family" }, doc: null, revision: null, refusal: null },
    setPage,
    note: vi.fn(),
  };
  const action = manifest.actions!.apply;
  return {
    run: () => action.run(ctx as never, undefined as never),
    preview: () => manifest.actions!.preview.run(ctx as never, undefined as never),
    read,
    direct,
    apply,
    setPage,
  };
}

describe("entity apply (MAP ruling 52)", () => {
  test("one press plans and applies when the plan declares no confirmation", async () => {
    const { run, read, apply, setPage } = route(false);
    expect(await run()).toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(expect.anything(), [ROW], expect.anything());
    expect(setPage).not.toHaveBeenCalledWith(
      expect.objectContaining({ confirming: true }),
      expect.anything(),
    );
  });

  test("a row the plan refuses stops the one press before anything applies", async () => {
    const { run, apply } = route(false, [{ ...ROW, flag: "refused by the plan" }]);
    expect(await run()).toMatchObject({ message: "a: refused by the plan" });
    expect(apply).not.toHaveBeenCalled();
  });

  test("a confirmed plan opens the sheet on press 1 and changes nothing", async () => {
    const { run, apply, setPage } = route(true);
    expect(await run()).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(setPage).toHaveBeenCalledWith(
      expect.objectContaining({ confirming: true, sheet: { entries: [ROW] } }),
      ["stage", "pod", "path"],
    );
  });
});

test("a composed Apply submits once without a browser planning round trip", async () => {
  const { run, read, direct, apply, setPage } = route(false, [ROW], true);
  expect(await run()).toBeNull();
  expect(direct).toHaveBeenCalledOnce();
  expect(direct).toHaveBeenCalledWith(expect.anything(), { pod: "p", path: "a.json", sha256: "s" });
  expect(read).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect(setPage).not.toHaveBeenCalled();
});

test("explicit Preview opens included rows and never invokes the composed Apply", async () => {
  const { preview, read, direct, apply, setPage } = route(false, [ROW], true);
  await preview();
  expect(read).toHaveBeenCalledOnce();
  expect(direct).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect(setPage).toHaveBeenCalledWith(
    expect.objectContaining({ confirming: true, sheet: { entries: [ROW] } }),
    ["stage", "pod", "path"],
  );
});
