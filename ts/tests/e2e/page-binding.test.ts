import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPageBinding, documentTarget } from "./page-binding.ts";

test("document mutations fail closed on rendered binding, independently of URL", async () => {
  const old = { ...process.env };
  process.env.E2E_TARGET = JSON.stringify({ kind: "document", ref: { session: "s", openId: "copy" } });
  process.env.E2E_SESSION = "s";
  process.env.E2E_WEB = "http://fixture/fans";
  delete process.env.E2E_LINKAGE_MODE;
  const visible = { getClientRects: () => [1] };
  const page = (ids: string[], chooser = false) => ({ evaluate: async (fn: () => unknown) => {
    const prior = globalThis.document;
    globalThis.document = { querySelectorAll: (selector: string) => selector === '[data-list-trigger]'
      ? chooser ? [{ ...visible, getAttribute: () => "Choose a document" }] : []
      : ids.map(id => ({ getAttribute: () => id, querySelectorAll: () => [visible] })) } as unknown as Document;
    try { return fn(); } finally { globalThis.document = prior; }
  } }) as Parameters<typeof assertPageBinding>[0];
  try {
    await assertPageBinding(page(["copy"]));
    await assert.rejects(assertPageBinding(page(["other"])), /rendered document/);
    await assert.rejects(assertPageBinding(page([])), /rendered document/);
    await assert.rejects(assertPageBinding(page(["copy"], true)), /chooser/);
    await assert.rejects(assertPageBinding(page(["copy"]), "fixture-linkage"), /real target/);
    assert.throws(() => documentTarget(process.env.E2E_TARGET, "wrong"), /matching session/);
    assert.throws(() => documentTarget('{"kind":"open","ref":{"session":"s","openId":"copy"}}', "s"), /explicit document/);
    delete process.env.E2E_TARGET;
    delete process.env.E2E_SESSION;
    process.env.E2E_WEB = "http://fixture/fans?target=real";
    await assert.rejects(assertPageBinding(page([]), "fixture-linkage"), /real target/);
    process.env.E2E_WEB = "http://fixture/fans";
    await assertPageBinding({ evaluate: async () => { throw Error("fixture must not inspect a real page"); } } as never, "fixture-linkage");
    await assert.rejects(assertPageBinding(page(["copy"])), /explicit document/);
  } finally { process.env = old; }
});
