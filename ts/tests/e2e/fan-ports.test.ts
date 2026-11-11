import { expect, test } from "vite-plus/test";
import { subjectCode, uniqueIdSchema } from "../../packages/agent-contracts/src/subject-ref.ts";
import { fanPortsAgree } from "./fan-ports.ts";

// The id the /fans roster mints (apps/web/src/fans/host.ts): a real `UniqueId:<unit>#port:<n>` code.
const id = (port: number) =>
  subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("3f2a-unit-0001"), sub: { port } });

test("a real #port:<n> id agrees with the selected row's port", () => {
  expect(id(1)).toMatch(/#port:1$/);
  expect(fanPortsAgree([id(1)], ["FC-11 / port 1"])).toBe(true);
  expect(fanPortsAgree([id(8), id(7)], ["B160E75RS / port 7", "B160E75RS / port 8"])).toBe(true);
  expect(fanPortsAgree([id(2)], ["FC-11 / port 1"])).toMatch(/ports \[2\] vs selected/);
  expect(fanPortsAgree([], [])).toBe(true);
});

test("a selection the URL does not name never passes with nothing to check", () => {
  expect(fanPortsAgree([], ["FC-11 / port 1"])).toMatch(/names no fan/);
  // The retired `<unit>@<n>` spelling and a portless ref are refused, not read as "?".
  expect(fanPortsAgree(["3f2a-unit-0001@1"], ["FC-11 / port 1"])).toMatch(/no SubjectRef/);
  expect(fanPortsAgree(["UniqueId:3f2a-unit-0001"], ["FC-11 / port 1"])).toMatch(/names no port/);
});
