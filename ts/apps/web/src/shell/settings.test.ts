import { expect, test, vi } from "vite-plus/test";
import {
  graphFieldPolicy,
  settingsSchema,
  type RouteSettingsSnapshot,
  type SettingField,
} from "@pe/agent-contracts";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { createSettingsOwner } from "./settings";
import { graphUrlPage } from "./mount-page";
import { createGraphMount } from "./mount-owner";
import { pane, type RouteGraph } from "@pe/agent-contracts";

// Test-local: no product route declares per-user settings yet.
const proofSettingFields = {
  terminalFlow: {
    ...field(z.string().trim().min(1).default("PE_M_Grd_AirFlow"), {}),
    role: "setting",
    label: "Grille airflow",
  },
  fanFlow: {
    ...field(z.string().trim().min(1).default("PE_M_Fan_AirFlowDesign"), {}),
    role: "setting",
    label: "Unit airflow",
  },
  supplyColour: {
    ...field(
      z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#0569a5"),
      {},
    ),
    role: "setting",
    label: "Supply air colour",
    control: "color",
  },
} satisfies Record<string, SettingField>;
const defaults = settingsSchema(proofSettingFields).parse({}) as RouteSettingsSnapshot["values"];
test("settings cannot enter Page, URLs or shares, including explicit policy overrides", () => {
  const graph: RouteGraph<object> = {
    key: "settings-proof",
    address: "settings-proof",
    name: "Proof",
    fields: { ...proofSettingFields },
    readings: {},
    verbs: {},
    panes: { body: { label: "Body", purpose: "proof", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["body"], verbs: [] } },
    layout: pane("body"),
  };
  const owner = createGraphMount(graph, {
    getSnapshot: () => ({ target: { kind: "host" }, work: null }),
    subscribe: () => () => {},
    sources: {},
    write: vi.fn(),
    subscribeAcceptedDeltas: () => () => {},
  });
  expect(owner.view.read().page).toEqual({});
  expect(graphUrlPage(graph).write({ supplyColour: "#123456" })).toEqual({});
  expect(graphUrlPage(graph).read({ terminalFlow: "ignored" })).toEqual({});
  expect(graphFieldPolicy({ role: "setting", url: "push", share: true, agent: false })).toEqual({
    url: false,
    share: false,
    agent: "set",
  });
  owner.dispose();
});

test("an agent notification updates the shared owner; late hydration cannot replace a newer write", async () => {
  let notify!: () => void;
  let finish!: (snapshot: RouteSettingsSnapshot) => void;
  let saved = { revision: 0, values: defaults };
  const owner = createSettingsOwner(proofSettingFields, {
    read: vi
      .fn()
      .mockResolvedValueOnce(saved)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async () => saved),
    write: async (patch, revision) =>
      (saved = {
        revision: revision + 1,
        values: { ...saved.values, ...patch } as RouteSettingsSnapshot["values"],
      }),
    subscribe: (fn) => {
      notify = fn;
      return () => {};
    },
  });
  const release = owner.connect();
  await vi.waitFor(() => expect(owner.read().revision).toBe(0));
  notify();
  await owner.set({ supplyColour: "#123456" });
  finish({ revision: 0, values: defaults });
  await Promise.resolve();
  expect(owner.read().values.supplyColour).toBe("#123456");
  saved = { revision: 2, values: { ...saved.values, fanFlow: "Agent flow" } };
  notify();
  await vi.waitFor(() => expect(owner.read().values.fanFlow).toBe("Agent flow"));
  release();
});

test("invalid settings never reach the transport, and failed saves retain the acknowledged value", async () => {
  const write = vi.fn(async () => {
    throw Error("host unavailable");
  });
  const owner = createSettingsOwner(proofSettingFields, {
    read: async () => ({ revision: 0, values: defaults }),
    write,
    subscribe: () => () => {},
  });
  await owner.refresh();
  await expect(owner.set({ supplyColour: "red" })).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
  expect(owner.read().error).not.toBeNull();
  await expect(owner.set({ supplyColour: "#123456" })).rejects.toThrow("host unavailable");
  expect(owner.read().values.supplyColour).toBe(defaults.supplyColour);
});

test("a background read cannot unlock an in-flight settings save", async () => {
  let finish!: (snapshot: RouteSettingsSnapshot) => void;
  const owner = createSettingsOwner(proofSettingFields, {
    read: async () => ({ revision: 0, values: defaults }),
    write: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    subscribe: () => () => {},
  });
  await owner.refresh();
  const saving = owner.set({ fanFlow: "New flow" });
  await owner.refresh();
  expect(owner.read().pending).toBe(true);
  await expect(owner.set({ fanFlow: "Overlapping flow" })).rejects.toThrow("Wait for settings");
  finish({ revision: 1, values: { ...defaults, fanFlow: "New flow" } });
  await saving;
  expect(owner.read().pending).toBe(false);
  expect(owner.read().values.fanFlow).toBe("New flow");
});
