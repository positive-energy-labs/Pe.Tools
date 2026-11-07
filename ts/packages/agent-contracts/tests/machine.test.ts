import { expect, test } from "vite-plus/test";
import { discoveryMachine } from "../src/discovery-machine.ts";
import { settingsValue } from "../src/settings-read.ts";
import { chatValue } from "../src/chat-read.ts";
import { machineSchema } from "../src/machine.ts";
import { machineFixture } from "./machine-fixture.ts";

const machine = () => machineFixture([{ session: "revit", documents: [] }]);

test("Settings refuses malformed nested Machine evidence instead of accepting a typed assertion", () => {
  const value = machine();
  expect(machineSchema.safeParse(JSON.parse(JSON.stringify(value))).success).toBe(true);
  expect(settingsValue.safeParse({ machine: value }).success).toBe(true);
  for (const broken of [
    {
      ...value,
      revit: {
        ...value.revit,
        sessions: [{ ...value.revit.sessions![0], row: { case: "invented" } }],
      },
    },
    { ...value, update: { ...value.update, receiptLeg: { observedAtUtc: null } } },
    { ...value, providers: [{ id: "invalid-provider" }] },
    { ...value, revit: { ...value.revit, years: ["2026"] } },
    {
      ...value,
      revit: {
        ...value.revit,
        sessions: [
          {
            ...value.revit.sessions![0],
            row: {
              ...value.revit.sessions![0]!.row,
              process: {
                pid: "wrong",
                processStartUtc: value.observedAtUtc,
                executable: "Revit.exe",
              },
            },
          },
        ],
      },
    },
  ])
    expect(settingsValue.safeParse({ machine: broken }).success).toBe(false);
});

test("bounded discovery evidence validates its counts and detail request", () => {
  const value = machine();
  const session = value.revit.sessions![0]!;
  const bounded = discoveryMachine({
    ...value,
    revit: {
      ...value.revit,
      sessions: [
        {
          ...session,
          holdings: [
            {
              openId: "model",
              title: "MEP",
              holdings: {
                elements: [],
                worksets: [],
                empty: true,
                savedNotSynced: null,
                unsaved: false,
                workshared: false,
              },
            },
          ],
        },
      ],
    },
  });
  expect(settingsValue.safeParse({ machine: JSON.parse(JSON.stringify(bounded)) }).success).toBe(
    true,
  );
  const row = bounded.revit.sessions![0]!;
  const document = row.holdings![0]!;
  const invalid = {
    ...bounded,
    revit: {
      ...bounded.revit,
      sessions: [
        {
          ...row,
          holdings: [
            {
              ...document,
              holdings: { ...document.holdings, elementCount: "many" },
            },
          ],
        },
      ],
    },
  };
  expect(settingsValue.safeParse({ machine: invalid }).success).toBe(false);
});

test("Chat validates Machine evidence inside its capability catalog through the same authority", () => {
  const value = machine();
  const capabilities = {
    at: value.observedAtUtc,
    machine: value,
    sources: {},
    diagnostics: [],
    capabilities: [],
  };
  expect(chatValue.safeParse({ machine: value, capabilities }).success).toBe(true);
  expect(
    chatValue.safeParse({
      machine: value,
      capabilities: {
        ...capabilities,
        machine: { ...value, update: { ...value.update, automatic: "yes" } },
      },
    }).success,
  ).toBe(false);
});
