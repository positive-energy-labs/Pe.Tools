import { expect, test } from "vite-plus/test";
import { deriveOpActivity } from "../src/index.ts";

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
