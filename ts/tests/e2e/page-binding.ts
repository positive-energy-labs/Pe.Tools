import assert from "node:assert/strict";
import type { Page } from "./cdp.ts";

export function documentTarget(raw: string | undefined, session: string | undefined) {
  const target = JSON.parse(raw || "null");
  assert.ok(
    session &&
      target?.kind === "document" &&
      target.ref?.session === session &&
      typeof target.ref.openId === "string" &&
      target.ref.openId.length,
    "PRECONDITION: explicit document target and matching session required",
  );
  return target.ref as { session: string; openId: string };
}

/** Fixture linkage is opt-in and refuses any real document target. */
export async function assertPageBinding(
  page: Pick<Page, "evaluate">,
  mode = process.env.E2E_LINKAGE_MODE,
) {
  if (mode === "fixture-linkage") {
    assert.ok(
      !process.env.E2E_TARGET &&
        !process.env.E2E_SESSION &&
        !new URL(process.env.E2E_WEB ?? "http://fixture").searchParams.has("target"),
      "PRECONDITION: fixture linkage cannot carry a real target/session",
    );
    return;
  }
  const target = documentTarget(process.env.E2E_TARGET, process.env.E2E_SESSION);
  const state = await page.evaluate(() => {
    const visible = (e: Element) => e.getClientRects().length > 0;
    return {
      chooser: [...document.querySelectorAll("[data-list-trigger]")].some(
        (e) =>
          visible(e) &&
          /Choose a document/.test(`${e.getAttribute("aria-label") ?? ""} ${e.textContent ?? ""}`),
      ),
      bindings: [...document.querySelectorAll("[data-bound-document]")]
        .filter((e) => [...e.querySelectorAll("[data-list-trigger]")].some(visible))
        .map((e) => ({
          session: e.getAttribute("data-bound-session"),
          openId: e.getAttribute("data-bound-document"),
        })),
    };
  });
  assert.ok(!state.chooser, "PRECONDITION: document chooser is visible");
  assert.deepEqual(
    state.bindings,
    [target],
    "PRECONDITION: rendered document binding must match target session and openId",
  );
}
