import { describe, expect, it } from "vite-plus/test";
import { address } from "../src/reading.ts";
import {
  bridgeSelector,
  emptyScope,
  resolveScope,
  scopeKey,
  scopeSchema,
  type FleetSession,
} from "../src/scope.ts";

const CF = address("C:\\Fixtures\\project-a Residence.rvt");
const DOOR = address("C:\\Fixtures\\Door-Single.rfa");
const s = (id: string, year: number, document: FleetSession["document"] = null): FleetSession => ({
  id,
  year,
  document,
});
const cf = { kind: "document", document: CF } as const;

describe("resolveScope, the lean model", () => {
  it("nothing chosen: the only session is picked, several are unchosen", () => {
    expect(resolveScope(emptyScope, [])).toEqual({ kind: "unchosen", sessions: [] });
    expect(resolveScope(emptyScope, [s("a", 2025, CF)])).toEqual({
      kind: "resolved",
      via: "only",
      session: "a",
      document: CF,
    });
    expect(resolveScope(emptyScope, [s("a", 2025), s("b", 2025)])).toEqual({
      kind: "unchosen",
      sessions: ["a", "b"],
    });
  });

  it("one holder resolves via holder; two holders are ambiguous; a pin breaks the tie", () => {
    expect(resolveScope(cf, [s("a", 2025, CF), s("b", 2025)])).toMatchObject({
      via: "holder",
      session: "a",
    });
    expect(resolveScope(cf, [s("a", 2025, CF), s("b", 2025, CF)])).toEqual({
      kind: "ambiguous",
      document: CF,
      holders: ["a", "b"],
    });
    expect(resolveScope({ ...cf, pin: "b" }, [s("a", 2025, CF), s("b", 2025, CF)])).toMatchObject({
      via: "pin",
      session: "b",
    });
  });

  it("a pin whose session moved on is ignored; the document rules run and gone never appears", () => {
    const fleet = [s("a", 2025, CF), s("b", 2025, DOOR)];
    expect(resolveScope({ ...cf, pin: "b" }, fleet)).toMatchObject({ via: "holder", session: "a" });
    expect(resolveScope({ ...cf, pin: "zz" }, [s("a", 2025, CF)])).toMatchObject({ via: "holder" });
  });

  it("unheld lists only same-year sessions; empty eligible means start that year", () => {
    const fleet = [s("r24", 2024), s("r25", 2025), s("r26", 2026)];
    expect(resolveScope(cf, fleet, 2025)).toEqual({
      kind: "unheld",
      document: CF,
      eligible: ["r25"],
    });
    expect(resolveScope(cf, fleet, 2023)).toEqual({ kind: "unheld", document: CF, eligible: [] });
    expect(resolveScope(cf, fleet)).toEqual({
      kind: "unheld",
      document: CF,
      eligible: ["r24", "r25", "r26"],
    });
  });

  it("the schema has two kinds; the key ignores the pin; the selector carries it", () => {
    expect(scopeSchema.safeParse({ kind: "session", session: "a" }).success).toBe(false);
    expect(scopeSchema.safeParse({ kind: "pinned", session: "a", document: CF }).success).toBe(
      false,
    );
    expect(scopeKey({ ...cf, pin: "a" })).toBe(scopeKey(cf));
    expect(bridgeSelector(emptyScope)).toBeUndefined();
    expect(bridgeSelector(cf)).toBe(`doc:${CF}`);
    expect(bridgeSelector({ ...cf, pin: "a" })).toBe(`pin:a|doc:${CF}`);
  });
});
