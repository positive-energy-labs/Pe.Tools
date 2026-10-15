import { describe, expect, it } from "vite-plus/test";
import { summarizeFailure } from "./failure-summary.ts";

// Verbatim from the owner's first native notice (tray, 2026-10-13 23:50).
const BOOTSTRAP =
  "session.bootstrap-mismatch: Installed Revit 2025 bootstrap, loader or bridge is another build's code than this CLI's image (signatures are ignored); a new Revit process would load another candidate. Pe.Revit.Loader.Bootstrap.dll differs: installed 0.1.0-beta.208+44b07e06540622cf54543d1a155ce82ccc19d440 (file 0.1.0.0) vs this CLI's 0.1.0-beta.207+d458282266a924c74a811d1bea54ae91516e8fb6 (file 0.1.0.0) (version skew: 0.1.0-beta.208 installed, 0.1.0-beta.207 here); Pe.Revit.Loader.dll differs: installed 0.1.0-beta.208+44b07e06540622cf54543d1a155ce82ccc19d440 (file 0.1.0.0) vs this CLI's 0.1.0-beta.207+d458282266a924c74a811d1bea54ae91516e8fb6 (file 0.1.0.0) (version skew: 0.1.0-beta.208 installed, 0.1.0-beta.207 here); Pe.Revit.Bridge.addin names bridge 1f01135ff004, this CLI's is 4fb87f18a8bc: installed 0.1.0-beta.208+44b07e06540622cf54543d1a155ce82ccc19d440 (file 0.1.0.0) vs this CLI's 0.1.0-beta.207+d458282266a924c74a811d1bea54ae91516e8fb6 (file 0.1.0.0) (version skew: 0.1.0-beta.208 installed, 0.1.0-beta.207 here)";

describe("one failure presentation", () => {
  it("says a known refusal in one line, names its door, and folds the raw text", () => {
    const failure = summarizeFailure(BOOTSTRAP);
    expect(failure.code).toBe("session.bootstrap-mismatch");
    expect(failure.summary).toBe(
      "Revit's add-ins are a newer Pe.Revit build (beta.208) than this checkout (beta.207)",
    );
    expect(failure.door).toEqual({
      label: "Align Revit add-ins with this build",
      href: "/settings?section=revit#align-addins",
    });
    expect(failure.detail).toBe(BOOTSTRAP);
  });
  it("says the older direction when the checkout is ahead", () => {
    const older = BOOTSTRAP.replaceAll(
      "0.1.0-beta.208 installed, 0.1.0-beta.207 here",
      "0.1.0-beta.206 installed, 0.1.0-beta.207 here",
    );
    expect(summarizeFailure(older).summary).toBe(
      "Revit's add-ins are an older Pe.Revit build (beta.206) than this checkout (beta.207)",
    );
  });
  it("falls back to the first sentence of an unknown code, never the whole blob", () => {
    const failure = summarizeFailure(
      "doc.bad-body: conflict belongs to a cloud open. The request named session a and open b; retry after sync.",
    );
    expect(failure).toMatchObject({
      code: "doc.bad-body",
      summary: "Conflict belongs to a cloud open",
      door: null,
    });
    expect(failure.detail).toContain("retry after sync");
  });
  it("keeps a plain one-sentence body whole with nothing to fold", () => {
    expect(summarizeFailure("Installed while no Revit was open.")).toEqual({
      code: null,
      summary: "Installed while no Revit was open",
      door: null,
      detail: null,
    });
  });
  it("caps a run-on first sentence", () => {
    const summary = summarizeFailure(`op.failed: ${"word ".repeat(80)}`).summary;
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.endsWith("…")).toBe(true);
  });
});
