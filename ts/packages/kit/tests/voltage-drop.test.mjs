import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import { calculate, sizes } from "../../../../examples/pods/snowdon-circuits/pages/tour/calc.mjs";

test("single phase uses the outgoing and return conductor", () => {
  const result = calculate({ size: "10", length: 200, amps: 10, voltage: 120, phase: "1" });
  assert.ok(Math.abs(result.drop - 4.971098265895954) < 1e-10);
  assert.ok(Math.abs(result.percent - 4.142581888246628) < 1e-10);
});
test("balanced three phase uses sqrt(3), and larger conductors reduce drop", () => {
  const input = { size: "10", length: 150, amps: 24, voltage: 208, phase: "3" };
  const result = calculate(input);
  assert.ok(Math.abs(result.drop - (Math.sqrt(3) * 12.9 * 24 * 150) / 10380) < 1e-10);
  assert.ok(calculate({ ...input, size: "8" }).drop < result.drop);
  assert.equal(calculate({ ...input, amps: 0 }).drop, 0);
  assert.equal(calculate({ ...input, length: 0 }).drop, 0);
});
test("invalid input never produces a plausible number", () => {
  const input = { size: "10", length: 150, amps: 24, voltage: 208, phase: "3" };
  for (const delta of [
    { voltage: 0 },
    { length: -1 },
    { amps: NaN },
    { amps: "" },
    { size: "bogus" },
    { phase: "2" },
  ])
    assert.throws(() => calculate({ ...input, ...delta }));
  assert.equal(sizes.length, 10);
});
test("the hosted Pod Page retains authored source and loads only its same-host kit door", async () => {
  const html = await readFile(
    new URL("../../../../examples/pods/snowdon-circuits/pages/tour/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /pe\.kit/);
  assert.match(html, /id="page-source"/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/);
  assert.match(html, /<script src="\/pages\/pe\.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src=["'](?!\/pages\/pe\.js)/);
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(code);
});
