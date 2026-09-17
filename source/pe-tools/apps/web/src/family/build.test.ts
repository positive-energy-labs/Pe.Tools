/**
 * THE BUILD CEREMONY'S SAFETY MODEL, under test.
 *
 * `build_evidence` reads the SAVED document — not the table, not the draft — and writes a real file
 * into Revit. Every predicate below exists because that gap between what the page shows and what the
 * build would read is a way for the surface to lie, and a refusal nobody tested is a refusal that
 * will one day not fire. These are pure functions for exactly that reason.
 */
// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { address } from "@pe/agent-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BUILD_ACTION,
  type BuildFacts,
  buildOutputPath,
  buildPlanHash,
  buildReceiptSummary,
  buildRefusals,
  buildTarget,
  issueText,
  projectBuildReceipt,
} from "./build.tsx";
import {
  familyManifest,
  latestBuildStatus,
  type FamilyAuthoringFacts,
  type FamilyBuildReview,
} from "./manifest.ts";
import { useRoute } from "#/route";

/** A live lane with a saved, valid, bound, unarmed document — the one state that may arm. */
const CLEAN: BuildFacts = {
  relativePath: "models/fcu.json",
  versionToken: "7",
  validation: { isValid: true, issues: [] },
  unsavedCount: 0,
  stagedCount: 0,
  boundTarget: "rrd",
  armedToken: "7",
};

const codes = (facts: BuildFacts) => buildRefusals(facts).map((refusal) => refusal.code);
const says = (facts: BuildFacts) => buildRefusals(facts).map((refusal) => refusal.says);

const authoring = (current = true): FamilyAuthoringFacts => ({
  relativePath: "refline.json",
  versionToken: "fixture-native-v1",
  validation: { isValid: true, issues: [] },
  unsavedCount: 0,
  stagedCount: 0,
  current,
});

const buildManifest = (current = true) => {
  const declared = familyManifest(authoring(current));
  const seed = declared.seeds?.build;
  if (!seed) throw Error("The Family build seed is required");
  return {
    ...declared,
    seeds: {
      build: {
        ...seed,
        target: { kind: "document" as const, ref: { session: "revit-a", openId: "family-a" } },
      },
    },
  };
};

describe("build ActionHandles — declaration, and the seeded lane's read-only floor", () => {
  it("declares document-needing actions and refuses every one of them under a frozen seed", async () => {
    const declared = buildManifest();
    expect(declared.needs).toBe("document");
    expect(declared.actions?.["prepare-build"].needs).toBe("document");
    expect(declared.actions?.build.needs).toBe("document");
    const familyReading = declared.readings?.family;
    if (typeof familyReading !== "function") throw Error("Family Reading must follow its Work");
    expect(
      familyReading(declared.page!.parse({}), {
        route: "family",
        target: address("C:\\Models\\Example.rfa"),
        work: "demo",
      }),
    ).toEqual({
      kind: "family-readings",
      work: { route: "family", target: null, work: "demo" },
    });

    // `?demo=build` selects the manifest's build seed, and a seed is FROZEN: use-route refuses
    // every action and every Work write before an action's own predicates are consulted. That
    // read-only floor is the ruling (see takeoff/ownership.test.tsx), so the build ceremony's
    // refusal ladder cannot be driven here — `buildRefusals` below owns it as pure functions.
    history.replaceState(null, "", "/family?demo=build");
    const { result } = renderHook(() => useRoute(buildManifest(true), { work: "demo" }));

    expect(result.current.demo).toBe(true);
    expect(result.current.actions.build.refusal).toBe("frozen seed is read-only");
    expect(result.current.actions["prepare-build"].refusal).toBe("frozen seed is read-only");
    await act(async () => {
      expect(await result.current.actions["prepare-build"].run({ reason: "rc" })).toMatchObject({
        code: "not-ready",
      });
    });
    expect(result.current.page[0].buildReview ?? null).toBeNull();
    cleanup();
    history.replaceState(null, "", "/");
  });
});

describe("build receipt projection", () => {
  const target = { session: "revit-a", openId: "family-a" };
  const review: FamilyBuildReview = {
    target,
    source: { pod: "demo", path: "settings/family/refline.json", sha256: "7".repeat(64) },
    reason: "release candidate",
  };
  const status = (id: string, startedAt: string, request = review) => ({
    kind: "workflow" as const,
    id,
    key: "family.build",
    actor: "human" as const,
    destination: { kind: "document" as const, ref: target },
    request,
    bases: {},
    startedAt,
    publication: { state: "unrequested" as const },
    state: "succeeded" as const,
  });

  it("selects the newest success for the exact saved profile and renders its owned result", () => {
    expect(
      latestBuildStatus(
        [
          status("older", "2026-09-14T01:00:00.000Z"),
          status("other-version", "2026-09-14T03:00:00.000Z", {
            ...review,
            source: { ...review.source, sha256: "8".repeat(64) },
          }),
          status("current", "2026-09-14T02:00:00.000Z"),
        ],
        target,
        review,
      )?.id,
    ).toBe("current");

    const projected = projectBuildReceipt(
      [
        {
          ...status("current", "2026-09-14T02:00:00.000Z"),
          steps: [],
          preparation: { state: "unprepared" },
          recovery: [],
          result: {
            outputPath: "C:/build/refline.rfa",
            native: {
              reading: {
                at: address("C:/build/refline.rfa"),
                version: "native-v1",
                observedAt: "2026-09-14T02:00:01.000Z",
              },
              familyName: "Reference Line",
              outputPath: "C:/build/refline.rfa",
              templatePath: "C:/templates/Generic Model.rft",
              converged: true,
              residueCount: 0,
            },
          },
        },
      ],
      "current",
    );
    expect(projected).toEqual({
      id: "current",
      outputPath: "C:/build/refline.rfa",
      converged: true,
      residueCount: 0,
    });
    expect(buildReceiptSummary(projected!)).toBe("C:/build/refline.rfa · converged · 0 residues");
  });
});

describe("buildRefusals — the ceremony's whole safety model", () => {
  it("a saved, valid, bound document at the armed revision arms", () => {
    expect(buildRefusals(CLEAN)).toEqual([]);
  });

  it("the fixture lane refuses ALONE — with no file, the other questions are meaningless", () => {
    // Everything else is also wrong here, and the refusal list is still exactly one long: a
    // newcomer must not be handed four sentences when one fix makes three of them moot.
    expect(
      codes({
        ...CLEAN,
        relativePath: null,
        boundTarget: "",
        unsavedCount: 4,
        validation: { isValid: false, issues: ["nope"] },
      }),
    ).toEqual(["no-document"]);
  });

  it("an unsaved draft refuses, and says so in the number of values", () => {
    expect(codes({ ...CLEAN, unsavedCount: 3 })).toEqual(["unsaved"]);
    expect(says({ ...CLEAN, unsavedCount: 3 })[0]).toContain(
      "3 draft values that the file does not",
    );
    expect(says({ ...CLEAN, unsavedCount: 1 })[0]).toContain(
      "1 draft value that the file does not",
    );
    // The REASON, not just the fact: the build reads the file, so an unsaved draft means the .rfa
    // would not be the thing the table is showing.
    expect(says({ ...CLEAN, unsavedCount: 3 })[0]).toContain("SAVED document");
    expect(says({ ...CLEAN, unsavedCount: 3 })[0]).toContain("save profile first");
  });

  it("a staged field refuses even with a clean draft — another route's unsaved edit still counts", () => {
    expect(codes({ ...CLEAN, stagedCount: 2 })).toEqual(["unsaved"]);
    expect(says({ ...CLEAN, stagedCount: 2 })[0]).toContain(
      "2 staged fields that the file does not",
    );
  });

  it("both kinds of unsaved are named in ONE refusal, not two", () => {
    const refusals = buildRefusals({ ...CLEAN, unsavedCount: 1, stagedCount: 2 });
    expect(refusals.map((refusal) => refusal.code)).toEqual(["unsaved"]);
    expect(refusals[0]!.says).toContain("1 draft value and 2 staged fields that the file does not");
  });

  it("an invalid saved document refuses with the host's FIRST issue verbatim", () => {
    const facts: BuildFacts = {
      ...CLEAN,
      validation: {
        isValid: false,
        issues: [{ message: "types.Compact: unknown parameter 'Bore'" }, { message: "second" }],
      },
    };
    expect(codes(facts)).toEqual(["invalid"]);
    expect(says(facts)[0]).toContain("types.Compact: unknown parameter 'Bore'");
    expect(says(facts)[0]).not.toContain("second");
  });

  it("an invalid document with no itemised issue still refuses, and says that is itself a reason", () => {
    const facts: BuildFacts = { ...CLEAN, validation: { isValid: false, issues: [] } };
    expect(codes(facts)).toEqual(["invalid"]);
    expect(says(facts)[0]).toContain("no issue was itemised");
  });

  it("a validation the host never ran does not refuse — absence is not a failing verdict", () => {
    expect(buildRefusals({ ...CLEAN, validation: null })).toEqual([]);
  });

  it("an unbound session refuses, because the build runs INSIDE Revit", () => {
    expect(codes({ ...CLEAN, boundTarget: "" })).toEqual(["unbound"]);
    expect(says({ ...CLEAN, boundTarget: "" })[0]).toContain("bind a world");
  });

  it("THE DRIFT REFUSAL: a document saved underneath the plan supersedes it, citing both hashes", () => {
    const facts: BuildFacts = { ...CLEAN, armedToken: "7", versionToken: "8" };
    expect(codes(facts)).toEqual(["superseded"]);
    expect(says(facts)[0]).toContain("v7");
    expect(says(facts)[0]).toContain("v8");
    expect(says(facts)[0]).toContain("Re-plan");
  });

  it("an UNARMED strip has no plan to supersede, however the token moved", () => {
    expect(buildRefusals({ ...CLEAN, armedToken: null, versionToken: "9" })).toEqual([]);
  });

  it("an untokened document arms — and a token appearing under it supersedes the plan", () => {
    expect(buildRefusals({ ...CLEAN, armedToken: null, versionToken: null })).toEqual([]);
    expect(codes({ ...CLEAN, armedToken: "7", versionToken: null })).toEqual(["superseded"]);
    expect(says({ ...CLEAN, armedToken: "7", versionToken: null })[0]).toContain("untokened");
  });

  it("several refusals stand together, worst-fixed-first, each keeping its own reason", () => {
    // A save fixes `unsaved` and also re-tokens the document, which is why `superseded` sits after
    // it: the ORDER is what has to be fixed first, not how bad each one is.
    expect(
      codes({
        ...CLEAN,
        boundTarget: "",
        unsavedCount: 2,
        validation: { isValid: false, issues: ["bad"] },
        armedToken: "6",
      }),
    ).toEqual(["unbound", "unsaved", "invalid", "superseded"]);
  });
});

describe("the arming preview — which family, from which document, to which .rfa", () => {
  it("names the source and the admitted action output pattern", () => {
    expect(buildOutputPath("models/fcu.json")).toBe(".artifacts/tmp/family/<action-id-sha256>.rfa");
    expect(buildTarget(CLEAN, "Fan Coil Unit")).toBe(
      "Fan Coil Unit · models/fcu.json → .artifacts/tmp/family/<action-id-sha256>.rfa",
    );
  });

  it("says so plainly when there is no document to name", () => {
    expect(buildTarget({ ...CLEAN, relativePath: null }, "the fixture")).toBe(
      "the fixture · no document open",
    );
  });

  it("the version token IS the plan hash — the document at a revision is the plan", () => {
    expect(buildPlanHash("7")).toBe("v7");
    expect(buildPlanHash(null)).toBe("untokened");
  });

  it("the verb label is one constant, so the arming verb and the commit cannot drift apart", () => {
    expect(BUILD_ACTION).toBe("build .rfa");
  });
});

describe("issueText — host issues are `unknown` on the wire", () => {
  it("reads a message, passes a string through, and stringifies anything else", () => {
    expect(issueText({ message: "boom" })).toBe("boom");
    expect(issueText("boom")).toBe("boom");
    expect(issueText({ code: 4 })).toBe('{"code":4}');
  });
});
