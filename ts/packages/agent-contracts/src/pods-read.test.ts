import { expect, test } from "vite-plus/test";
import { podMemberCode, podMemberOfCode } from "./pods-read.ts";
import { subjectCode } from "./subject-ref.ts";

test("only a name subject decodes as a Pod member", () => {
  const member = { pod: "a", path: "b" };
  expect(podMemberOfCode(podMemberCode(member))).toEqual(member);
  // A two-character text key has length 2 and indexes as [pod, path]; its kind is what refuses it.
  for (const keyKind of ["workspace", "region", "group", "system-name"] as const)
    expect(podMemberOfCode(subjectCode({ keyKind, key: "ab" })), keyKind).toBeNull();
});
