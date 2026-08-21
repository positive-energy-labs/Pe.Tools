/**
 * THE BUILD CEREMONY'S SAFETY MODEL, under test.
 *
 * `build_evidence` reads the SAVED document — not the table, not the draft — and writes a real file
 * into Revit. Every predicate below exists because that gap between what the page shows and what the
 * build would read is a way for the surface to lie, and a refusal nobody tested is a refusal that
 * will one day not fire. These are pure functions for exactly that reason.
 */
import { describe, expect, it } from "vite-plus/test";

import { isEvidenceStale } from "./lane.ts";
import {
  BUILD_VERB,
  type BuildFacts,
  buildOutputPath,
  buildPlanHash,
  buildReceiptLine,
  buildRefusals,
  buildTarget,
  issueText,
  readBuildReceipt,
} from "./build.tsx";

/** A live lane with a saved, valid, bound, unarmed document — the one state that may arm. */
const CLEAN: BuildFacts = {
  relativePath: "models/fcu.family.json",
  versionToken: "7",
  validation: { isValid: true, issues: [] },
  unsavedCount: 0,
  stagedCount: 0,
  boundTarget: "rrd",
  armedToken: "7",
};

const codes = (facts: BuildFacts) => buildRefusals(facts).map((refusal) => refusal.code);
const says = (facts: BuildFacts) => buildRefusals(facts).map((refusal) => refusal.says);

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
  it("names all three, and mirrors build_evidence's own default output path", () => {
    // The `.json` really does stay in the middle: the host builds the name from the relative path
    // verbatim. A prettier name here would be a path that does not exist.
    expect(buildOutputPath("models/fcu.family.json")).toBe(
      ".artifacts/tmp/family/models-fcu.family.json-<timestamp>.rfa",
    );
    expect(buildTarget(CLEAN, "Fan Coil Unit")).toBe(
      "Fan Coil Unit · models/fcu.family.json → .artifacts/tmp/family/models-fcu.family.json-<timestamp>.rfa",
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
    expect(BUILD_VERB).toBe("build .rfa");
  });
});

describe("the staleness law — a fresh crossing clears it by replacing the stamp, not by exception", () => {
  it("a stamp from another revision is stale; the same revision is not", () => {
    expect(isEvidenceStale("6", "7")).toBe(true);
    expect(isEvidenceStale("7", "7")).toBe(false);
  });

  it("an UNSTAMPED read claims nothing either way — capture has no revision to stamp", () => {
    // `capture_evidence` reads out of Revit, not out of a document, so it stamps null. Null must
    // never read as stale (it would cry wolf on every capture) or as fresh (it would vouch for a
    // revision nobody checked).
    expect(isEvidenceStale(null, "7")).toBe(false);
    expect(isEvidenceStale(undefined, "7")).toBe(false);
  });

  it("an untokened document cannot be disagreed with", () => {
    expect(isEvidenceStale("6", null)).toBe(false);
  });

  it("a BUILD's own evidence is never stale — it stamps the revision it just read", () => {
    // This is the no-special-casing claim: build_evidence returns the token it opened the document
    // at, so the chip goes out because the stamps AGREE, not because build was exempted.
    const documentToken = "7";
    expect(isEvidenceStale(documentToken, documentToken)).toBe(false);
  });
});

describe("issueText — host issues are `unknown` on the wire", () => {
  it("reads a message, passes a string through, and stringifies anything else", () => {
    expect(issueText({ message: "boom" })).toBe("boom");
    expect(issueText("boom")).toBe("boom");
    expect(issueText({ code: 4 })).toBe('{"code":4}');
  });
});

describe("readBuildReceipt — a build with no receipt is not a success", () => {
  it("reads the full receipt build_evidence returns", () => {
    expect(
      readBuildReceipt({
        familyName: "Fan Coil Unit",
        rfaPath: "C:/x/.artifacts/tmp/family/fcu-20260817-141500.rfa",
        typeNames: ["Compact"],
        parameterCount: 12,
        documentVersionToken: "7",
      }),
    ).toEqual({
      familyName: "Fan Coil Unit",
      rfaPath: "C:/x/.artifacts/tmp/family/fcu-20260817-141500.rfa",
      documentVersionToken: "7",
      parameterCount: 12,
    });
  });

  it("the PATH is what makes it a receipt — without one the outcome is unknown", () => {
    expect(readBuildReceipt(null)).toBeNull();
    expect(readBuildReceipt("ok")).toBeNull();
    expect(readBuildReceipt({})).toBeNull();
    expect(readBuildReceipt({ familyName: "Fan Coil Unit" })).toBeNull();
    expect(readBuildReceipt({ rfaPath: "" })).toBeNull();
  });

  it("names the family generically rather than inventing one, and tolerates a missing count", () => {
    expect(readBuildReceipt({ rfaPath: "out.rfa" })).toEqual({
      familyName: "the family",
      rfaPath: "out.rfa",
      documentVersionToken: null,
      parameterCount: null,
    });
  });

  it("the receipt line carries family, path and when — the three facts a build is judged on", () => {
    const line = buildReceiptLine(
      {
        familyName: "Fan Coil Unit",
        rfaPath: "out.rfa",
        documentVersionToken: "7",
        parameterCount: 12,
      },
      "14:15:00",
    );
    expect(line).toBe("built Fan Coil Unit → out.rfa · 12 params · captured 14:15:00");
  });
});
