import { describe, expect, test } from "vite-plus/test";
import { acceptancePlan, liveIdentity, parseSdkEnvelope } from "../src/main.ts";

describe("runtime acceptance plan", () => {
  test("deterministic is the mandatory public-product proof; showcase is separate", () => {
    expect(acceptancePlan("deterministic").map(({ id }) => id)).toEqual([
      "authority",
      "rrd-baseline",
      "attached-and-fresh",
      "source-sandbox",
      "installed-sandbox",
      "hot-reload-coexistence",
      "routing-and-service",
      "worktree-coexistence",
      "no-save-close",
      "cleanup",
    ]);
    expect(acceptancePlan("showcase").map(({ id }) => id)).toEqual(["pea-chat"]);
  });

  test("hidden convergence cannot enter either plan", () => {
    for (const profile of ["deterministic", "showcase"] as const) {
      for (const gate of acceptancePlan(profile)) {
        expect(gate.lifecycle).not.toContain("implicit");
        expect(gate.lifecycle.every((action) => /^(none|live |sandbox |test )/.test(action))).toBe(
          true,
        );
      }
    }
  });
});

describe("SDK command seam", () => {
  test("accepts one envelope and rejects empty, invalid, or non-envelope stdout", () => {
    const envelope = {
      result: { state: "ready" },
      resolved: { id: "source-e2e" },
      diagnostics: [],
      nextSteps: [],
      guide: "sandbox",
      related: [],
    };
    expect(parseSdkEnvelope(JSON.stringify(envelope))).toEqual(envelope);
    for (const stdout of ["", "not json", "{}", `${JSON.stringify(envelope)}\n{}`]) {
      expect(() => parseSdkEnvelope(stdout)).toThrow();
    }
  });

  test("live identity requires both pid and process start time", () => {
    expect(
      liveIdentity({
        result: {
          bridges: [
            { pid: 42, processStartUtc: "2026-07-13T07:11:52.7833022Z", sessionDescriptor: "x" },
          ],
        },
        resolved: {},
        diagnostics: [],
        nextSteps: [],
        guide: "live-loop",
        related: ["pe-revit live status"],
      }),
    ).toEqual({ pid: 42, processStartUtc: "2026-07-13T07:11:52.7833022Z" });
    expect(() =>
      liveIdentity({
        result: { bridges: [{ pid: 42 }] },
        resolved: {},
        diagnostics: [],
        nextSteps: [],
        guide: "live-loop",
        related: ["pe-revit live status"],
      }),
    ).toThrow();
  });
});
