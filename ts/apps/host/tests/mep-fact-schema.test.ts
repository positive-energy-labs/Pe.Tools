import { readFile } from "node:fs/promises";
import { Ajv } from "ajv";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { expect, test } from "vite-plus/test";

const raw = JSON.parse(hostOpCatalog.find((op) => op.key === "mep.system.members")!.responseSchemaJson);
delete raw.$schema;
const ajv = new Ajv({ strict: false, allErrors: true });

// A10b MembersRaw.cs, Chadds: first system retained verbatim; the remaining 386 systems omitted.
test("Chadds native bytes with an Absent source validate against the generated response", async () => {
  const bytes = await readFile(new URL("./native-recordings/chadds-mep-absent-source.json", import.meta.url), "utf8");
  const validate = ajv.compile(raw);
  expect(validate(JSON.parse(bytes)), JSON.stringify(validate.errors)).toBe(true);
});

test.each(["MepFactOfMepSource", "MepFactOfMepElementRef", "MepFactOfString", "MepFactOfNullableDouble"])(
  "%s allows present null for Absent and Error, but still requires value and its declared type", (name) => {
    const validate = ajv.compile({ definitions: raw.definitions, $ref: `#/definitions/${name}` });
    for (const state of ["Absent", "Error"])
      expect(validate({ state, value: null }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ state: "Absent" })).toBe(false);
    expect(validate({ state: "Value", value: [] })).toBe(false);
  },
);
