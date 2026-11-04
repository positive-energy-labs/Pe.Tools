import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { createSettingsOwner } from "./settings";

test("concurrent mounts, StrictMode remount and hidden return share one settings read", async () => {
  const read = vi.fn(async () => ({ revision: 1, values: { word: "kept" } }));
  const owner = createSettingsOwner(
    { word: { ...field(z.string().default(""), {}), role: "setting", label: "Word" } },
    {
      read,
      write: vi.fn(),
      subscribe: () => () => {},
    },
  );
  const releases = Array.from({ length: 7 }, () => owner.connect());
  releases.forEach((release) => release());
  const release = owner.connect();
  await vi.waitFor(() => expect(owner.read().revision).toBe(1));
  release();
  const show = owner.connect();
  expect(owner.read().values.word).toBe("kept");
  expect(read).toHaveBeenCalledTimes(1);
  show();
});
