import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import { chromeExecutable } from "../../../../packages/browser/src/platform.ts";

// jsdom has no layout, so the real stylesheet is hit-tested in a headless browser. The fixture is
// the gate drive's measured tab: a 28px "Fans" label and its 24px close (VERDICT fix line 1).
test("a Place tab's label never sits under its close", async () => {
  const dir = mkdtempSync(join(tmpdir(), "route-tabs-"));
  try {
    const tab = (n: number) =>
      `<span><button id="label${n}" style="width:28px;height:24px"></button><button id="close${n}" style="width:24px;height:24px"></button></span>`;
    writeFileSync(
      join(dir, "tabs.html"),
      `<!doctype html><style>button{all:unset;display:block}${readFileSync(join(import.meta.dirname, "route-tabs.css"), "utf8")}</style>
<span data-slot="route-tabs" style="display:flex">${tab(1)}${tab(2)}</span>
<script>
const hit = el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id; };
const out = { rest: [hit(label1), hit(label2)] };
close1.focus();
Object.assign(out, { focused: [hit(label1), hit(close1), hit(label2)] });
document.body.textContent = "OUT" + JSON.stringify(out) + "END";
</script>`,
    );
    const dom = execFileSync(
      await chromeExecutable(),
      ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${join(dir, "profile")}`, "--dump-dom", pathToFileURL(join(dir, "tabs.html")).href],
      { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    expect(JSON.parse(/OUT(.*)END/.exec(dom)![1]!)).toEqual({
      rest: ["label1", "label2"],
      // Keyboard focus reveals the close beside the label, and it takes its own clicks.
      focused: ["label1", "close1", "label2"],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}, 90_000);
