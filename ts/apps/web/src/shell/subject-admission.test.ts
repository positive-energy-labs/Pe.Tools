import { test, expect } from "vite-plus/test";
import { systemSubjectGraph as ductsGraph } from "./subject.test-support";
import { fanSubjectGraph as fansGraph } from "./subject.test-support";
import { registerSubject, publishSubjectRoster, subjectState } from "./subject";

test("unknown and malformed subject links refuse by name before Place enrollment", () => {
  registerSubject("ducts", ductsGraph);
  publishSubjectRoster("ducts", {}, [{ id: "SA-1", label: "SA-1" }]);
  expect(subjectState("ducts", { system: "nonexistent-zzz" })).toMatchObject({
    ready: false,
    refusal: "system nonexistent-zzz not in this model",
  });
  expect(subjectState("ducts", { system: [1, 2] })).toMatchObject({
    ready: false,
    refusal: "system [1,2] is malformed",
  });
  expect(subjectState("ducts", { system: null })).toMatchObject({ ready: false });
  expect(subjectState("ducts", { system: "SA-1" })).toMatchObject({
    ready: true,
    refusal: null,
    label: "SA-1",
  });
});
test("fan titles use roster display labels including duplicate-mark disambiguators", () => {
  registerSubject("fans", fansGraph);
  publishSubjectRoster("fans", {}, [
    { id: "uid-a@0", label: "FC-23 \u00b7 100" },
    { id: "uid-b@0", label: "FC-23 \u00b7 200" },
  ]);
  expect(subjectState("fans", { fan: "uid-a%400" }).label).toBe("FC-23 \u00b7 100");
  expect(subjectState("fans", { fan: "uid-b%400" }).label).toBe("FC-23 \u00b7 200");
  expect(subjectState("fans", { fan: "uid-a%400", target: "other-model" }).ready).toBe(false);
});

test("Place admission waits for declaration and roster, distinguishing an empty roster", () => {
  expect(subjectState("not-registered", {}).ready).toBe(false);
  registerSubject("admission-fans", fansGraph);
  expect(subjectState("admission-fans", { fan: "uid-a%400" })).toMatchObject({
    ready: false,
    refusal: null,
  });
  publishSubjectRoster("admission-fans", {}, []);
  expect(subjectState("admission-fans", { fan: "uid-a%400" })).toMatchObject({
    ready: false,
    refusal: expect.stringContaining("not in this model"),
  });
  expect(subjectState("admission-fans", { fan: "" })).toMatchObject({ ready: true, refusal: null });
});
