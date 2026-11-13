import { expect, test } from "vite-plus/test";
import { subjectCode, uniqueIdSchema, familyTypeName } from "@pe/agent-contracts/subject-ref";
import { subjectName } from "./subject-name.ts";
test("one subject namer uses the roster, names ports, and hides unknown raw element codes", () => {
  expect(subjectName(subjectCode({ keyKind: "name", key: ["Fam", "Type"] }))).toBe("Fam · Type");
  expect(subjectName(subjectCode({ keyKind: "name", key: ["Hidden_Internal", "Type"] }))).toBe("Type");
  const ref = { keyKind: "UniqueId", key: uniqueIdSchema.parse("abcdefgh-long-key") } as const;
  const code = subjectCode(ref);
  const roster = [{ id: code, label: "FC-11" }];
  expect(subjectName(code, roster)).toBe("FC-11");
  expect(subjectName(subjectCode({ ...ref, sub: { port: 1 } }), roster)).toBe("FC-11 · port 1");
  expect(subjectName(code)).toBe("element abcdefgh");
  expect(familyTypeName({ family: "Hidden_Internal", type: "Type" })).toBe("Type");
  expect(familyTypeName({ family: "Fam", type: "Type" })).toBe("Fam · Type");
});
