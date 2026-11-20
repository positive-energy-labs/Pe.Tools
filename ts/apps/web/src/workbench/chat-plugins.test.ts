import { describe, expect, it } from "vite-plus/test";
// Registration is the import, as in `routes/__root.tsx`.
import "../route/builtin-routes";

import {
  actionReceiptSchema,
  memberWork,
  podMemberCode,
  catalogWorkCommands,
  catalogWorkSpecs,
} from "@pe/agent-contracts";

import {
  actionPlace,
  actionRoute,
  capturedPlace,
  proposedRecord,
  receiptRoute,
} from "./chat-plugins";

const member = { pod: "mechanical", path: "settings/family.json" };
/** The /pods Page a member opens on: the member as its one subject. */
const memberPage = { member: { kind: "ids", ids: [podMemberCode(member)] } };
const workspace = {
  binding: "workspace" as const,
  route: "pods",
  target: null,
  work: memberWork(member),
};
const settingsReceipt = (request: Record<string, unknown>, work = true) =>
  actionReceiptSchema.parse({
    id: "settings-observation",
    key: "settings.observe",
    input: request,
    consumes: work
      ? [
          {
            kind: "work",
            probe: { handle: { key: workspace, revision: 4 }, paths: [["fields"]] },
            expected: {},
          },
        ]
      : [],
    target: { kind: "host" },
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    state: "succeeded",
    result: { envelope: { revision: 5 } },
    steps: [],
    recovery: [],
    prepared: { state: "ready", value: {} },
    startedAt: "2026-10-26T00:00:00.000Z",
  });

describe("chat plugin records", () => {
  it("an action opens the pane whose manifest declares a verb doing it, never a guess at its words", async () => {
    expect(actionRoute("takeoffs.adopt")).toBe("takeoffs");
    expect(actionRoute("rooms.merge")).toBe("rooms");
    expect(actionRoute("settings.write")).toBe("pods");
    expect(actionRoute("settings.observe")).toBe("pods");
    expect(actionRoute("instances.open")).toBe("open");
    // Route-free Work owns its commands without a Page (ADR 0030 rule 2).
    for (const [key, command] of Object.entries(catalogWorkCommands)) {
      expect(
        Object.values(catalogWorkSpecs).some((spec) => spec.route === command.work.route),
      ).toBe(true);
      expect(actionRoute(key)).toBeNull();
    }
    // No pane declares these: the record keeps its receipt link instead of inventing an owner.
    expect(actionRoute("takeoffs.sync")).toBeNull();
    expect(actionRoute("schedule.nonexistent")).toBeNull();
    expect(actionRoute("pod.list")).toBeNull();
    expect(actionRoute("takeoffs")).toBeNull();
  });

  it("a findings.say names the route whose Work its receipt consumed, never the first route that declares findings (gate-1ebf1fb1: 'Pea ran write in Families' on a fan port)", () => {
    const consumed = (route: string) =>
      ({
        consumes: [
          {
            kind: "work",
            probe: {
              handle: { key: { binding: "address", route, target: "c:/model.rvt" }, revision: 1 },
            },
          },
        ],
      }) as never;
    // No route declares the findings command (the mount adds it to each): the key alone names no route.
    expect(actionRoute("findings.say")).toBeNull();
    expect(receiptRoute("findings.say", consumed("fans"))).toBe("fans");
    expect(receiptRoute("findings.say", consumed("families"))).toBe("families");
    // Pea's write through the findings Work handle came from no route; the line names none.
    expect(receiptRoute("findings.say", consumed("findings"))).toBeNull();
    expect(receiptRoute("findings.say", undefined)).toBeNull();
  });

  it("host-only settings receipts retain their exact member and Work without a chat document", () => {
    expect(actionPlace("pods", settingsReceipt({ member }))).toMatchObject({
      ok: true,
      page: memberPage,
      carry: { target: "", work: workspace.work },
    });
    // A source input cannot redirect a receipt whose durable Work key names another member.
    expect(
      capturedPlace("pods", workspace, { pod: "other", path: "settings/other.json" }),
    ).toMatchObject({ ok: true, page: memberPage, carry: { work: workspace.work } });
    expect(actionPlace("pods", settingsReceipt({ member }, false))).toMatchObject({ ok: false });
    expect(
      capturedPlace("pods", { binding: "host", route: "pods", target: null }, {}),
    ).toMatchObject({
      ok: false,
      refusal: expect.stringContaining("exact pod member"),
    });
  });

  it("counts repeated edits of a member field once and opens exact host-only member Work", () => {
    const record = proposedRecord(
      "pe_do",
      {
        key: "route:pods.edit",
        workspaceId: workspace.work,
        expectedRevision: 4,
        input: {
          patches: [
            { op: "set", path: ["fields", "/name", "edit"], value: { value: "New name" } },
            { op: "set", path: ["fields", "/name", "edit", "value"], value: "Final name" },
            {
              op: "set",
              path: ["fields", "/edit", "edit"],
              value: { value: "Optional field" },
            },
          ],
        },
      },
      { ok: true, target: { session: null, document: null }, result: { revision: 5 } },
    );
    expect(record).toMatchObject({
      changes: 2,
      subject: workspace.work,
      place: { ok: true, page: memberPage, carry: { target: "", work: workspace.work } },
    });
  });

  it("records root cells and domain maps without mistaking a cell key for its rung", () => {
    const record = proposedRecord(
      "pe_do",
      {
        key: "route:duct-systems.edit",
        expectedRevision: 2,
        input: {
          system: "AHU-1",
          patches: [
            { op: "set", path: ["localRate", "edit"], value: { value: 0.08 } },
            { op: "set", path: ["localRate", "edit", "value"], value: 0.1 },
            { op: "set", path: ["roles", "edit", "edit"], value: { value: { role: "fan" } } },
          ],
        },
      },
      { ok: true, target: { session: "original-session", document: "C:/Models/Original.rvt" } },
    );
    expect(record).toMatchObject({
      changes: 2,
      place: { ok: true, page: { system: { kind: "ids", ids: ["system-name:AHU-1"] } } },
    });
  });
});
