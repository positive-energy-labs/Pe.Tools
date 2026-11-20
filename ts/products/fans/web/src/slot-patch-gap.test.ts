import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { expect, test } from "vite-plus/test";

test("parameter slot names cannot enter Fans Work", () => {
  expect(
    fansDocumentSchema.safeParse({ parameters: { fanFlow: { edit: { value: "Flow" } } } }).success,
  ).toBe(false);
  expect(fansDocumentSchema.parse({})).not.toHaveProperty("parameters");
});
