import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { ISSUE_KINDS } from "@pe/ducts-web/issues";

it("every issue kind the C# enum can emit has one taxonomy entry, and no entry is orphaned", () => {
  const source = readFileSync(
    new URL("../../../../../dotnet/Pe.Shared.RevitData/Ducts/DuctContracts.cs", import.meta.url),
    "utf8",
  );
  const body = source.slice(source.indexOf("enum DuctIssueKind"));
  const emitted = [...body.slice(0, body.indexOf("}")).matchAll(/EnumMember\(Value = "([^"]+)"\)/g)]
    .map((match) => match[1])
    .sort();
  expect(emitted.length).toBeGreaterThan(0);
  expect(Object.keys(ISSUE_KINDS).sort()).toEqual(emitted);
});
