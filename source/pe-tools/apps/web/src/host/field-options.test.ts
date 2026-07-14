import { describe, expect, it } from "vite-plus/test";

import { parameterReferenceFromOption } from "#/host/field-options";

describe("parameterReferenceFromOption", () => {
  it("hydrates a canonical built-in parameter identity from provider metadata", () => {
    expect(
      parameterReferenceFromOption({
        value: "builtin:-1001203|instance",
        label: "Comments · instance",
        metadata: {
          key: "builtin:-1001203",
          kind: "BuiltInParameter",
          name: "Comments",
          scope: "instance",
          storageType: "String",
          builtInParameterId: "-1001203",
        },
      }),
    ).toEqual({
      identity: {
        key: "builtin:-1001203",
        kind: "BuiltInParameter",
        name: "Comments",
        builtInParameterId: -1001203,
        sharedGuid: null,
        parameterElementId: null,
      },
    });
  });

  it("rejects provider values without canonical identity metadata", () => {
    expect(() =>
      parameterReferenceFromOption({ value: "incomplete", label: "Incomplete parameter" }),
    ).toThrow("missing canonical identity metadata");
  });
});
