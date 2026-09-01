import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const here = dirname(fileURLToPath(import.meta.url));
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: here,
  encoding: "utf8",
}).trim();
const bridgeAgent = readFileSync(
  resolve(repo, "source/Pe.Revit.Global/Services/Host/BridgeAgent.cs"),
  "utf8",
);
const dispatch = bridgeAgent.slice(
  bridgeAgent.indexOf("private async Task HandleRequestAsync"),
  bridgeAgent.indexOf("private async Task WriteRevitTaskOutcomeAsync"),
);

describe("BridgeAgent Revit task dispatch", () => {
  it("keeps SDK queue outcomes typed and never guesses an operation timeout", () => {
    expect(dispatch).toContain("_revitTaskQueue.RunForResult(");
    expect(dispatch).toMatch(/new RevitRunOptions\s*\{\s*Label = op\.Key\s*\}/);
    expect(dispatch).not.toContain("Timeout =");
    expect(bridgeAgent).not.toContain("_inFlightOperationKey");
    expect(bridgeAgent).not.toContain("_requestExecutionSync");

    expect(bridgeAgent).toContain('RevitTaskOutcome.TimedOut => ("timed-out", 504)');
    expect(bridgeAgent).toContain(
      'RevitTaskOutcome.AbandonedStillRunning => ("abandoned-still-running", 423)',
    );
    expect(bridgeAgent).toContain(
      "RevitTaskOutcome.CancelledBeforeDispatch or RevitTaskOutcome.CancelledCooperatively",
    );
    expect(bridgeAgent).toContain(
      "new { error = message, statusCode, outcome = outcome.ToString(), verdict }",
    );
    expect(bridgeAgent).toContain("CompleteOpReceipt(receipt, verdict, responseJson)");
  });
});
