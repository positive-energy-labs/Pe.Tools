import { expect, test } from "vite-plus/test";
import { askExpiryOf, askExpiryTriggers, askLifetime } from "./thread.ts";

test("the ask expiry set is the ruled one", () => {
  expect(askExpiryTriggers).toEqual(["turn-end", "cancel", "host-restart", "new-turn"]);
});

test("a run end expires its asks unless the run is parked on them", () => {
  expect(askExpiryOf("suspended")).toBeNull();
  expect(askExpiryOf("complete")).toBe("turn-end");
  expect(askExpiryOf("error")).toBe("turn-end");
  expect(askExpiryOf(undefined)).toBe("turn-end");
  expect(askExpiryOf("aborted")).toBe("cancel");
  expect(askExpiryOf("new-turn")).toBe("new-turn");
});

test("the lifetime sentence is read from the set", () => {
  expect(askLifetime).toBe(
    "expires on turn end / cancel / host restart / new turn; survives navigation and reload",
  );
});
