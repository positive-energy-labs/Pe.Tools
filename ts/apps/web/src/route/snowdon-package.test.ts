import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import { verifyBundle } from "./pod-loader";

test("Snowdon's shipped route refuses changed or truncated package bytes", async () => {
  const bytes = await readFile(
    new URL(
      "../../../../../examples/pods/snowdon-circuits/routes/voltage-drop/index.js",
      import.meta.url,
    ),
  );
  const trustedHash = createHash("sha256").update(bytes).digest("hex");
  await expect(verifyBundle(bytes, trustedHash)).resolves.toBeUndefined();

  const changed = new Uint8Array(bytes);
  changed[0] = changed[0]! ^ 1;
  for (const tampered of [changed, bytes.subarray(0, bytes.length - 1)]) {
    await expect(verifyBundle(tampered, trustedHash)).rejects.toThrow("bytes changed");
  }
});
