import { expect, it } from "vite-plus/test";
import { builtinData, builtinModule } from "./route-kernel.fixtures.ts";
import { routeBindingSchema } from "./route-bodies.ts";
import { routeWorkSubject } from "./route-work-subject.ts";

it("uses the declared codec's decoded local subject, never encoded bytes", () => {
  const bindings = routeBindingSchema.parse(builtinModule);
  const id = builtinModule.identities.local.encode({
    namespace: "schedules",
    subject: "schedule:fixture",
  });
  if (!id.ok) throw Error(id.reason);
  expect(
    routeWorkSubject({ ...builtinData, workSubject: "system" }, bindings, { system: id.value }),
  ).toBe("schedule:fixture");
  expect(routeWorkSubject(builtinData, bindings, {})).toBeUndefined();
  expect(
    routeWorkSubject({ ...builtinData, workSubject: "system" }, bindings, { system: null }),
  ).toBe("default");
});

it("refuses identities whose declared kind cannot decode to a Work key", () => {
  const bindings = routeBindingSchema.parse(builtinModule);
  const data = {
    ...builtinData,
    workSubject: "system",
    identities: {
      ...builtinData.identities,
      system: { kind: "element" as const, codec: "element" },
    },
  };
  expect(() => routeWorkSubject(data, bindings, { system: null })).toThrow("Work key");
  expect(() => routeWorkSubject({ ...builtinData, workSubject: "search" }, bindings, {})).toThrow(
    "one local subject",
  );
});

it("refuses a codec result without a nonempty decoded Work key", () => {
  const bindings = routeBindingSchema.parse(builtinModule);
  const id = builtinModule.identities.local.encode({ namespace: "test", subject: "ok" });
  if (!id.ok) throw Error(id.reason);
  const broken = {
    identities: { local: { ...bindings.identities.local!, parts: () => ({ subject: 123 }) } },
  };
  expect(() =>
    routeWorkSubject({ ...builtinData, workSubject: "system" }, broken, { system: id.value }),
  ).toThrow("did not decode a Work key");
});
