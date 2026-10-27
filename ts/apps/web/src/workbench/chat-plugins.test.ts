import { describe, expect, it } from "vite-plus/test";

import { actionReceiptSchema, memberWork, commands } from "@pe/agent-contracts";

import { actionPlace, actionRoute, capturedPlace, proposedRecord } from "./chat-plugins";

const member = { pod: "mechanical", path: "settings/family.json" };
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
            handle: { key: workspace, revision: 4 },
            paths: [["fields"]],
            snapshot: {},
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
  it("a recorded schedule opens its declared workspace and retains the execution document", () => {
    const place = capturedPlace(
      "schedules",
      {
        binding: "workspace",
        route: "schedules",
        target: null,
        work: "schedule-42",
      },
      {},
      { kind: "open", ref: { session: "one", openId: "original" } },
    );
    expect(place).toMatchObject({
      ok: true,
      page: { workspaceId: "schedule-42" },
      carry: {
        work: "schedule-42",
        target: JSON.stringify({ kind: "open", ref: { session: "one", openId: "original" } }),
      },
    });
    expect(capturedPlace("schedules", null, {})).toMatchObject({ ok: false });
    expect(
      capturedPlace(
        "schedules",
        { binding: "workspace", route: "schedules", target: null, work: "schedule-42" },
        {},
      ),
    ).toMatchObject({ ok: false, refusal: expect.stringContaining("document target") });
  });
  it("an action opens the pane whose manifest declares a verb doing it, never a guess at its words", () => {
    expect(actionRoute("takeoffs.sync")).toBe("takeoffs");
    expect(actionRoute("rooms.merge")).toBe("rooms");
    expect(actionRoute("parameter-links.apply")).toBe("parameter-links");
    expect(actionRoute("family.build")).toBe("family");
    expect(actionRoute("family.observe")).toBe("family");
    expect(actionRoute("settings.write")).toBe("pods");
    expect(actionRoute("settings.observe")).toBe("pods");
    expect(actionRoute("schedule.grid.push")).toBe("schedules");
    expect(actionRoute("instances.open")).toBe("instances");
    // Every semantic action is some pane's: none falls back to a bare receipt link.
    expect(Object.keys(commands).filter((key) => !actionRoute(key))).toEqual([]);
    // No pane declares these: the record keeps its receipt link instead of inventing an owner.
    expect(actionRoute("schedule.nonexistent")).toBeNull();
    expect(actionRoute("pod.list")).toBeNull();
    expect(actionRoute("takeoffs")).toBeNull();
  });

  it("host-only settings receipts retain their exact member and Work without a chat document", () => {
    expect(actionPlace("pods", settingsReceipt({ member }))).toMatchObject({
      ok: true,
      page: member,
      carry: { target: "", work: workspace.work },
    });
    // A source input cannot redirect a receipt whose durable Work key names another member.
    expect(
      capturedPlace("pods", workspace, { pod: "other", path: "settings/other.json" }),
    ).toMatchObject({ ok: true, page: member, carry: { work: workspace.work } });
    expect(actionPlace("pods", settingsReceipt({ member }, false))).toMatchObject({ ok: false });
    expect(
      capturedPlace("pods", { binding: "host", route: "pods", target: null }, {}),
    ).toMatchObject({
      ok: false,
      refusal: expect.stringContaining("exact pod member"),
    });
  });

  it.each(["edit", "suggestion"])(
    "records a landed %s without requiring the other rung",
    (rung) => {
      const args = {
        key: "route:schedules.edit",
        workspaceId: "schedule-42",
        expectedRevision: 7,
        input: JSON.stringify({
          patches: [{ op: "set", path: ["cells", "2::1", rung], value: { value: "Supply" } }],
        }),
      };
      const record = proposedRecord("pe_do", JSON.stringify(args), {
        structuredContent: {
          ok: true,
          target: { session: "original-session", document: "C:/Models/Original.rvt" },
          result: { revision: 8, doc: { cells: { unrelated: { edit: { value: "Other" } } } } },
        },
      });
      expect(record).toMatchObject({
        route: "schedules",
        changes: 1,
        subject: "C:/Models/Original.rvt",
        place: {
          ok: true,
          page: { workspaceId: "schedule-42" },
          carry: {
            work: "schedule-42",
            target: JSON.stringify({
              kind: "named",
              session: "original-session",
              address: "C:/Models/Original.rvt",
            }),
          },
        },
      });
      expect(proposedRecord("pe_do", args, { ok: false })).toBeNull();
      expect(
        proposedRecord("pe_do", { ...args, key: "route:schedules.propose" }, { ok: true }),
      ).toBeNull();
    },
  );

  it("counts both rungs of a member field once and opens exact host-only member Work", () => {
    const record = proposedRecord(
      "pe_do",
      {
        key: "route:pods.edit",
        workspaceId: workspace.work,
        expectedRevision: 4,
        input: {
          patches: [
            { op: "set", path: ["fields", "/name", "edit"], value: { value: "New name" } },
            { op: "set", path: ["fields", "/name", "suggestion"], value: { value: "Optional" } },
            { op: "set", path: ["fields", "/name", "suggestion", "note"], value: "Evidence" },
            {
              op: "set",
              path: ["fields", "/edit", "suggestion"],
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
      place: { ok: true, page: member, carry: { target: "", work: workspace.work } },
    });
  });

  it("records root cells and domain maps without mistaking a cell key for its rung", () => {
    const record = proposedRecord(
      "pe_do",
      {
        key: "route:ducts.edit",
        expectedRevision: 2,
        input: {
          system: "AHU-1",
          patches: [
            { op: "set", path: ["designFriction", "edit"], value: { value: 0.08 } },
            { op: "set", path: ["designFriction", "suggestion"], value: { value: 0.1 } },
            { op: "set", path: ["roles", "edit", "suggestion"], value: { value: { role: "fan" } } },
          ],
        },
      },
      { ok: true, target: { session: "original-session", document: "C:/Models/Original.rvt" } },
    );
    expect(record).toMatchObject({ changes: 2, place: { ok: true, page: { system: ["AHU-1"] } } });
  });
});
