import { describe, expect, it } from "vite-plus/test";
import { claimInto, ownerOf, releaseFrom } from "../src/workbench/claims.ts";

// Cross-tab claim invariant: at most one live tab owns a thread; a second is blocked until the
// owner goes stale (closed) or explicitly takes over. Pure functions — no localStorage needed.

const TTL = 15_000;

describe("thread claims", () => {
  it("claims a free thread", () => {
    const { claims, got } = claimInto({}, "t1", "tabA", 1000);
    expect(got).toBe(true);
    expect(ownerOf(claims, "t1", 1000)).toBe("tabA");
  });

  it("blocks a second live tab on a fresh claim", () => {
    const owned = claimInto({}, "t1", "tabA", 1000).claims;
    const second = claimInto(owned, "t1", "tabB", 2000);
    expect(second.got).toBe(false);
    expect(ownerOf(owned, "t1", 2000)).toBe("tabA");
  });

  it("refreshing keeps the same owner (heartbeat)", () => {
    const owned = claimInto({}, "t1", "tabA", 1000).claims;
    const refreshed = claimInto(owned, "t1", "tabA", 6000);
    expect(refreshed.got).toBe(true);
    expect(ownerOf(refreshed.claims, "t1", 6000)).toBe("tabA");
  });

  it("reclaims a stale claim once the owner is gone (past TTL)", () => {
    const owned = claimInto({}, "t1", "tabA", 1000).claims;
    expect(ownerOf(owned, "t1", 1000 + TTL + 1)).toBeUndefined();
    const second = claimInto(owned, "t1", "tabB", 1000 + TTL + 1);
    expect(second.got).toBe(true);
    expect(ownerOf(second.claims, "t1", 1000 + TTL + 1)).toBe("tabB");
  });

  it("takeover steals a fresh claim", () => {
    const owned = claimInto({}, "t1", "tabA", 1000).claims;
    const stolen = claimInto(owned, "t1", "tabB", 2000, true);
    expect(stolen.got).toBe(true);
    expect(ownerOf(stolen.claims, "t1", 2000)).toBe("tabB");
  });

  it("release frees only our own claim", () => {
    const owned = claimInto({}, "t1", "tabA", 1000).claims;
    expect(ownerOf(releaseFrom(owned, "t1", "tabB"), "t1", 1000)).toBe("tabA"); // not ours → no-op
    expect(ownerOf(releaseFrom(owned, "t1", "tabA"), "t1", 1000)).toBeUndefined();
  });
});
