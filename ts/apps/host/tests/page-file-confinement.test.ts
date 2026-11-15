import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { createPagesHandler } from "../src/pages-route.ts";

// Page isolation review, finding 1: a junction inside a Page folder must not serve bytes from outside it.
test("a Page file served through a junction outside its Page folder is refused; a neighbour module still loads", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-page-confine-"));
  try {
    const pages = join(root, "Pages");
    const outside = join(root, "outside");
    mkdirSync(join(pages, "carriage"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.js"), "export const secret = 1;");
    writeFileSync(join(pages, "carriage", "index.html"), "<p>page</p>");
    writeFileSync(join(pages, "carriage", "mod.js"), "export const ok = 1;");
    symlinkSync(outside, join(pages, "carriage", "linked"), "junction");
    const handle = createPagesHandler(
      pages,
      [],
      undefined,
      undefined,
      stateFixture(join(root, "state")),
    );
    const escaped = await handle(new Request("http://host/pages/carriage/linked/secret.js"));
    expect(escaped.status).toBe(404);
    expect(await escaped.text()).not.toContain("secret = 1");
    expect((await handle(new Request("http://host/pages/carriage/mod.js"))).status).toBe(200);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
