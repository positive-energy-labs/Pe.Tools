import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { productPathNames } from "./contracts/product.ts";

it("the installed TS writer and C# support reader use the same log contract", () => {
  const native = readFileSync(
    new URL("../../../../dotnet/Pe.Shared.Product/ProductPathNames.cs", import.meta.url),
    "utf8",
  );
  const name = /HostLogFileName = "([^"]+)"/.exec(native)?.[1];
  expect(name).toBe(productPathNames.hostLogFileName);
  const writer = readFileSync(
    new URL("../../../apps/host/src/host-main.ts", import.meta.url),
    "utf8",
  );
  expect(writer).toContain("join(dir, productPathNames.hostLogFileName)");
  expect(writer).toContain("join(productRoot(), productPathNames.logsDirectoryName)");
});
