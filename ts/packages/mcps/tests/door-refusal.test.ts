import { normalizePeError } from "@pe/host-contracts/pe-api";
/**
 * A door's refusal reaches the person whole. The host answers 403 with the typed `refusal`; the
 * client keeps it on the thrown error so a surface can name the door, the reason and the remedy,
 * instead of printing the response body's JSON.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { runSemanticAction } from "../src/shared/takeoff-action-client.ts";

afterEach(() => vi.unstubAllGlobals());

const refusal = {
  code: "grant.required",
  door: "/actions",
  reason:
    "Refused at /actions: this would write your document S/open-1, and thread t1 holds no rw grant on it.",
  remedy: "Point this thread at the document in the composer.",
  lifetime: { session: "S", openId: "open-1" },
};

test("an admission refused at a door throws the typed refusal, not the body's JSON", async () => {
  vi.stubGlobal("fetch", async () =>
    normalizePeError(
      Response.json(
        { error: `${refusal.code}: ${refusal.reason}`, message: "m", refusal, notDispatched: true },
        { status: 403 },
      ),
    ),
  );
  const error = await runSemanticAction(
    "families.plan",
    {},
    { session: "S", openId: "open-1" },
  ).then(
    () => null,
    (caught: unknown) => caught as Error & { refusal?: unknown },
  );
  expect(error?.refusal).toEqual(refusal);
  expect(error?.message).toContain(refusal.reason);
  expect(error?.message).not.toContain("{");
});

test("a refusal that is not a door's stays the body text", async () => {
  vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
  const error = await runSemanticAction(
    "families.plan",
    {},
    { session: "S", openId: "open-1" },
  ).then(
    () => null,
    (caught: unknown) => caught as Error & { refusal?: unknown },
  );
  expect(error?.message).toContain("bad gateway");
  expect(error?.refusal).toBeUndefined();
});
