import { expect, test } from "vite-plus/test";
import {
  createWorkbenchState,
  deriveActivity,
  deriveOpActivity,
  selectSentenceSnapshot,
  type WorkbenchState,
  type WorkbenchToolCall,
} from "../src/index.ts";

const call = (title: string, rawInput?: unknown, extra?: Partial<WorkbenchToolCall>): WorkbenchToolCall => ({
  id: "t1",
  title,
  rawInput,
  ...extra,
});

test("op key ladder: read families look, apply edits, document.open navigates, scripting scripts", () => {
  expect(deriveOpActivity("revit.catalog.loaded-families").verb).toBe("looking");
  expect(deriveOpActivity("revit.detail.elements").verb).toBe("looking");
  expect(deriveOpActivity("revit.matrix.parameter-coverage").verb).toBe("looking");
  expect(deriveOpActivity("bridge.sessions.list").verb).toBe("looking");
  expect(deriveOpActivity("revit.apply.parameter-values")).toEqual({
    verb: "editing",
    gerund: "editing",
    target: "apply.parameter-values",
  });
  expect(deriveOpActivity("family.editor.apply").verb).toBe("editing");
  expect(deriveOpActivity("revit.apply.document.open").verb).toBe("navigating");
  expect(deriveOpActivity("family.editor.open").verb).toBe("navigating");
  expect(deriveOpActivity("scripting.execute").verb).toBe("scripting");
});

test("tool map is total and parses string rawInput", () => {
  expect(deriveActivity(call("script_execute")).verb).toBe("scripting");
  expect(deriveActivity(call("route_state_apply", { route: "family" }))).toEqual({
    verb: "suggesting",
    gerund: "suggesting",
    target: "family",
  });
  expect(deriveActivity(call("route_command", { route: "settings", command: "save" })).verb).toBe("editing");
  expect(deriveActivity(call("route_command", { route: "family", command: "open" })).verb).toBe("navigating");
  expect(deriveActivity(call("pe_sandbox", { action: "start" })).gerund).toBe("booting a world");
  // streamed args arrive as a JSON string
  expect(deriveActivity(call("host_operation_call", '{"key":"revit.context.summary"}')).verb).toBe("looking");
  // unparseable / unknown fall back to working
  expect(deriveActivity(call("host_operation_call", '{"key":')).verb).toBe("working");
  expect(deriveActivity(call("mystery_tool")).verb).toBe("working");
});

const withRun = (state: WorkbenchState, patch: Partial<WorkbenchState>): WorkbenchState => ({
  ...state,
  ...patch,
});

test("sentence snapshot: idle → working(active tool) → asking(approval) → failed surfaces in lastCompleted", () => {
  const base = createWorkbenchState();
  expect(selectSentenceSnapshot(base).phase).toBe("idle");

  const active = call("host_operation_call", { key: "revit.apply.document.open" }, { status: "in_progress" });
  const working = withRun(base, {
    uiStatus: { ...base.uiStatus, overall: { status: "running", activeToolCallId: "t1" } },
    tools: { ...base.tools, calls: [active], activeToolCallIds: ["t1"], recentToolCallIds: [] },
  });
  const snapshot = selectSentenceSnapshot(working);
  expect(snapshot.phase).toBe("working");
  expect(snapshot.activity?.gerund).toBe("opening");

  const asking = withRun(base, {
    approvals: {
      ...base.approvals,
      requests: [
        {
          requestId: "a1",
          sessionId: "s1",
          toolCall: call("script_execute"),
          options: [],
          status: "pending",
        },
      ],
    },
  });
  expect(selectSentenceSnapshot(asking).phase).toBe("asking");
  expect(selectSentenceSnapshot(asking).activity?.gerund).toContain("scripting");

  const failed = call("script_execute", undefined, { status: "failed", completedAt: "2026-07-16T00:00:00Z" });
  const afterFail = withRun(base, {
    tools: { ...base.tools, calls: [failed], activeToolCallIds: [], recentToolCallIds: ["t1"] },
  });
  const relaxed = selectSentenceSnapshot(afterFail);
  expect(relaxed.phase).toBe("idle");
  expect(relaxed.lastCompleted).toEqual(
    expect.objectContaining({ isError: true, completedAt: "2026-07-16T00:00:00Z" }),
  );
});
