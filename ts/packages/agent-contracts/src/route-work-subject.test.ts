import { expect, it } from "vite-plus/test";
import { builtinData } from "./route-kernel.fixtures.ts";
import { routeWorkSubject } from "./route-work-subject.ts";
import { subjectCode } from "./subject-ref.ts";

const data = { ...builtinData, workSubject: "system" };

it("decodes a workspace SubjectRef to its Work key, never the encoded bytes", () => {
  const id = subjectCode({ keyKind: "workspace", key: "schedule:fixture" });
  expect(routeWorkSubject(data, { system: id })).toBe("schedule:fixture");
  expect(routeWorkSubject(builtinData, {})).toBeUndefined();
  expect(routeWorkSubject(data, { system: null })).toBe("default");
});

it("refuses a non-workspace subject, an old spelling, and a non-subject field", () => {
  expect(() => routeWorkSubject(data, { system: subjectCode({ keyKind: "group", key: "g" }) })).toThrow(
    "workspace",
  );
  expect(() => routeWorkSubject(data, { system: '["schedules","s"]' })).toThrow();
  expect(() => routeWorkSubject({ ...builtinData, workSubject: "search" }, {})).toThrow(
    "one subject field",
  );
});
