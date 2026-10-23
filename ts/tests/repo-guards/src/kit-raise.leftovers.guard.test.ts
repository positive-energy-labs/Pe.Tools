/** Source census only; cannot prove pointer timing, camera placement, or browser paint. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const root =
  process.env.PE_LEFTOVERS_GUARD_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "latin1");

test.each([
  ["inbox", /\bintent\.current|const reveal = useRef/],
  ["canvas", /pendingSelection|selectionPublish|data-e-landed|const flash =/],
] as const)("%s leaves reach and landing mechanics to kit", (file, pattern) => {
  expect(read(`apps/web/src/ducts/proto/e/${file}.tsx`)).not.toMatch(pattern);
});

test.each(["floater", "pane-resize", "pane-strip"])("%s tests live with kit", (part) => {
  expect(existsSync(resolve(root, `apps/web/src/components/lang/${part}.test.tsx`))).toBe(false);
  expect(existsSync(resolve(root, `packages/kit/tests/${part}.test.tsx`))).toBe(true);
});
