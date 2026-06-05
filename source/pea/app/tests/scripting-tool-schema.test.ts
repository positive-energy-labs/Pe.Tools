import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scriptExecuteInputSchema } from "../tools/shared/scripting.js";

describe("scripting tool schema", () => {
  it("describes inline scriptContent as Execute-body statements by default", () => {
    const shape = scriptExecuteInputSchema.shape;

    assert.match(shape.scriptContent.description ?? "", /Execute-body statements/);
    assert.match(shape.scriptContent.description ?? "", /PeScriptContainer/);
    assert.match(shape.sourceKind.description ?? "", /Where source comes from/);
    assert.match(shape.sourceName.description ?? "", /diagnostics/);
  });
});
