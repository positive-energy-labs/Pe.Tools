import { expect, test, vi } from "vite-plus/test";

const rename = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  rename,
}));
import { renameReplacing } from "../src/rename-retry.ts";

const errno = (code: string) => Object.assign(new Error(code), { code });

test("a rename over a file a scanner still holds retries until the handle lets go", async () => {
  rename
    .mockRejectedValueOnce(errno("EPERM"))
    .mockRejectedValueOnce(errno("EBUSY"))
    .mockResolvedValueOnce(undefined);
  await renameReplacing("a.tmp", "a");
  expect(rename).toHaveBeenCalledTimes(3);
});

test("any other failure, or a handle that never lets go, is thrown", async () => {
  rename.mockReset().mockRejectedValueOnce(errno("ENOENT"));
  await expect(renameReplacing("a.tmp", "a")).rejects.toMatchObject({ code: "ENOENT" });
  expect(rename).toHaveBeenCalledTimes(1);
  rename.mockReset().mockRejectedValue(errno("EPERM"));
  await expect(renameReplacing("a.tmp", "a")).rejects.toMatchObject({ code: "EPERM" });
});
