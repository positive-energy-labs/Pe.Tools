import { expect, test } from "vite-plus/test";
import { deriveActivity, deriveOpActivity, type WorkbenchToolCall } from "../src/index.ts";

const call = (
  title: string,
  rawInput?: unknown,
  extra?: Partial<WorkbenchToolCall>,
): WorkbenchToolCall => ({
  id: "t1",
  title,
  rawInput,
  ...extra,
});

test("op key ladder: read families look, family editor open navigates, scripting scripts", () => {
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
  expect(deriveActivity(call("route_command", { route: "settings", command: "save" })).verb).toBe(
    "editing",
  );
  expect(deriveActivity(call("route_command", { route: "family", command: "open" })).verb).toBe(
    "navigating",
  );
  // pe_sandbox is deleted: session lifecycle is the SDK's `session_*` tools. An unlisted
  // tool falls back to "working", which is the honest thing to say about a tool we do not own.
  expect(deriveActivity(call("pe_sandbox", { action: "start" })).verb).toBe("working");
  // streamed args arrive as a JSON string
  expect(deriveActivity(call("host_operation_call", '{"key":"revit.context.summary"}')).verb).toBe(
    "looking",
  );
  // unparseable / unknown fall back to working
  expect(deriveActivity(call("host_operation_call", '{"key":')).verb).toBe("working");
  expect(deriveActivity(call("mystery_tool")).verb).toBe("working");
});
