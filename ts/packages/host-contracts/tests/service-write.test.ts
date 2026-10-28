import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { serviceFilePath, writeServiceFile, type ServiceFile } from "../src/vendor/pe-service.ts";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

let root: string;
const receipt: ServiceFile = {
  schemaVersion: 3,
  instanceId: "test-launch",
  pid: 1,
  processStartUtc: "2026-10-28T00:00:00Z",
  port: 12345,
  version: "test",
  lane: "dev",
  token: "test-token",
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-service-write-"));
  vi.mocked(rename).mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test.each(["EPERM", "EBUSY", "EACCES"])(
  "a transient %s preserves atomic receipt replacement",
  async (code) => {
    await writeServiceFile(root, "host", receipt);
    vi.mocked(rename).mockRejectedValueOnce(
      Object.assign(new Error("reader holds receipt"), { code }),
    );
    const next = { ...receipt, instanceId: "next-launch" };
    await writeServiceFile(root, "host", next);
    expect(JSON.parse(await readFile(serviceFilePath(root, "host"), "utf8"))).toEqual(next);
    expect(rename).toHaveBeenCalledTimes(3); // initial publish, refused replacement, successful replacement
    expect(await readdir(dirname(serviceFilePath(root, "host")))).toEqual(["host.json"]);
  },
);

test("persistent sharing failure is bounded and leaves the old receipt intact", async () => {
  await writeServiceFile(root, "host", receipt);
  vi.mocked(rename).mockClear();
  const failure = Object.assign(new Error("receipt remains locked"), { code: "EPERM" });
  vi.mocked(rename).mockRejectedValue(failure);
  await expect(
    writeServiceFile(root, "host", { ...receipt, instanceId: "next-launch" }),
  ).rejects.toBe(failure);
  expect(rename).toHaveBeenCalledTimes(5);
  expect(JSON.parse(await readFile(serviceFilePath(root, "host"), "utf8"))).toEqual(receipt);
  expect(await readdir(dirname(serviceFilePath(root, "host")))).toEqual(["host.json"]);
});

test("non-sharing errors fail immediately", async () => {
  const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
  vi.mocked(rename).mockRejectedValue(failure);
  await expect(writeServiceFile(root, "host", receipt)).rejects.toBe(failure);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(await readdir(dirname(serviceFilePath(root, "host")))).toEqual([]);
});
