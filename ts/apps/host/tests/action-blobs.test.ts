import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { rest } from "@pe/host-contracts/kinds";
import { get, put } from "../src/action-blobs.ts";
import { hostState } from "../src/host-ownership.ts";

test("action blobs use the machine's verified blob store", async () => {
  const bytes = Buffer.from("action blob witness");
  const ref = await put(bytes, "witness.txt");
  const file = rest(hostState(), bytes);
  expect(ref.digest).toBe(file.sha256);
  expect(readFileSync(file.blob)).toEqual(bytes);
  expect(await get(ref)).toEqual(bytes);
  await expect(get({ ...ref, size: bytes.length + 1 })).rejects.toMatchObject({ refusal: { code: "blob.corrupt" } });
  writeFileSync(file.blob, "tampered");
  await expect(get(ref)).rejects.toMatchObject({ refusal: { code: "blob.missing" } });
  await put(bytes, "witness.txt");
  expect(readFileSync(join(hostState().blobs, "sha256", ref.digest))).toEqual(bytes);
});
