import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  searchHostOperations,
  type HostCapabilityMapSearchResult,
  type HostOperationFullResult,
  type HostOperationSearchOutput,
} from "../host-operation-runtime.js";

function capabilityMapResult(output: HostOperationSearchOutput): HostCapabilityMapSearchResult {
  assert(!Array.isArray(output), "expected capability-map search result");
  assert.equal(output.kind, "hostCapabilityMap");
  return output;
}

function fullResults(output: HostOperationSearchOutput): HostOperationFullResult[] {
  assert(Array.isArray(output), "expected ranked operation matches");
  return output as HostOperationFullResult[];
}

describe("host operation discovery", () => {
  it("renders a compressed schedule and parameter capability map for broad discovery", () => {
    const result = capabilityMapResult(
      searchHostOperations({
        projection: "capability-map",
        query: "schedule parameter discovery",
        limit: 50,
      }),
    );

    assert.equal(result.format, "markdown");
    assert.match(result.rendered ?? "", /# Host capability map/);
    assert.match(result.rendered ?? "", /## Matrix/);
    assert.match(result.rendered ?? "", /## Catalog/);
    assert(result.matchedOperationKeys.includes("revit.catalog.schedules"));
    assert(result.matchedOperationKeys.includes("revit.matrix.schedule-coverage"));
    assert(result.matchedOperationKeys.includes("revit.catalog.parameter-bindings"));
    assert(result.matchedOperationKeys.includes("revit.matrix.parameter-coverage"));
  });

  it("can return normalized capability-map rows as json", () => {
    const result = capabilityMapResult(
      searchHostOperations({
        projection: "capability-map",
        capabilityMapFormat: "json",
        query: "parameter",
        limit: 25,
      }),
    );

    assert.equal(result.format, "json");
    assert.equal(result.rendered, undefined);
    const catalogSection = result.sections?.find((section) => section.id === "catalog");
    assert(catalogSection, "expected catalog section");
    const parameterEvidence = catalogSection.rows.find(
      (row) => row.key === "revit.catalog.parameter-evidence",
    );
    assert(parameterEvidence, "expected parameter evidence row");
    assert.match(parameterEvidence.inputKind, /bounded filters/);
    assert.match(parameterEvidence.outputKind, /candidate handles\/list/);
    assert.equal("area" in parameterEvidence, false);
    assert.equal("input" in parameterEvidence, false);
    assert.equal("output" in parameterEvidence, false);
    assert.equal("relations" in parameterEvidence, false);
  });

  it("keeps TOON as an optional preview rendering only", () => {
    const result = capabilityMapResult(
      searchHostOperations({
        projection: "capability-map",
        capabilityMapFormat: "toon",
        query: "schedule coverage",
        limit: 10,
      }),
    );

    assert.equal(result.format, "toon");
    assert.equal(result.sections, undefined);
    assert.match(result.rendered ?? "", /^kind: hostCapabilityMap/m);
    assert.match(
      result.rendered ?? "",
      /rows\[\d+\]\{key,description,safety,inputKind,outputKind,terms\}:/,
    );
    assert(result.matchedOperationKeys.includes("revit.matrix.schedule-coverage"));
  });

  it("preserves full ranked operation metadata for exact execution planning", () => {
    const results = fullResults(
      searchHostOperations({
        projection: "matches",
        query: "revit matrix schedule coverage",
        verbosity: "full",
        limit: 8,
      }),
    );
    const scheduleCoverage = results.find(
      (result) => result.key === "revit.matrix.schedule-coverage",
    );

    assert(scheduleCoverage, "expected schedule coverage operation");
    assert.equal(scheduleCoverage.route, "/api/revit/matrix/schedule-coverage");
    assert(scheduleCoverage.requestShape.some((field) => field.name === "scheduleFilter"));
    assert(scheduleCoverage.responseShape.some((field) => field.name === "missingHandles"));
    assert(scheduleCoverage.searchTerms.includes("coverage"));
    assert.equal("domain" in scheduleCoverage, false);
    assert.equal("intent" in scheduleCoverage, false);
    assert.equal("family" in scheduleCoverage, false);
    assert.equal("revitLayer" in scheduleCoverage, false);
    assert.equal("domainNoun" in scheduleCoverage, false);
    assert.equal("preflightHints" in scheduleCoverage, false);
    assert.match(scheduleCoverage.safeDefaultRequestJson ?? "", /"scheduleFilter"/);
  });

  it("shows DTO-aligned safe defaults for query-wrapper detail operations", () => {
    const results = fullResults(
      searchHostOperations({
        projection: "matches",
        query: "schedule profile detail elements",
        verbosity: "full",
        limit: 20,
      }),
    );

    const scheduleDetail = results.find((result) => result.key === "revit.detail.schedules");
    const scheduleProfiles = results.find(
      (result) => result.key === "revit.matrix.schedule-profiles",
    );
    const elementDetail = results.find((result) => result.key === "revit.detail.elements");

    assert(scheduleDetail, "expected schedule detail operation");
    assert(scheduleProfiles, "expected schedule profiles operation");
    assert(elementDetail, "expected element detail operation");
    assert.match(scheduleDetail.safeDefaultRequestJson ?? "", /^\{ "query": \{/);
    assert.match(scheduleProfiles.safeDefaultRequestJson ?? "", /^\{ "query": \{/);
    assert.match(elementDetail.safeDefaultRequestJson ?? "", /^\{ "query": \{/);
    assert(scheduleProfiles.searchTerms.includes("authored-schedule-shape"));
    assert(elementDetail.searchTerms.includes("requested-parameters"));
  });
});
