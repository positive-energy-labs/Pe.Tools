// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { elementKey } from "@pe/kit/lang/attention";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { snapshot } from "@pe/ducts-web/test-fixture";
import sheetFixture from "./calc/calc.fixture.json";
import { makeAtomRegistry } from "../../../../apps/web/src/shell/owner.ts";
import { createWitness } from "./cutover.test-support.ts";
import { ductsLink, namesOf } from "@pe/ducts-web/identity";
import { fields } from "@pe/duct-systems-web/route";
import { calcSystems } from "@pe/ducts-web/calc/scoped-snapshot";

/*
 * Ruling 2026-11-10, verdict 1: a Fans Ledger fix whose Work is /ducts' is a link, named by what it
 * fixes, that opens /ducts with that subject selected. Nothing on /fans stages /ducts Work.
 */
const closes: (() => void)[] = [];
afterEach(() => { cleanup(); for (const close of closes.splice(0).reverse()) close(); });

/** The recorded blocker, re-pointed for one test and restored after it. */
function pointBlocker(at: { elementId: number; subject?: string }) {
  const fixture = sheetFixture.inputs.blockers[0]! as { elementId: number; subject?: string };
  const recorded = { ...fixture };
  Object.assign(fixture, at);
  if (at.subject === undefined) delete fixture.subject;
  closes.push(() => { delete fixture.subject; Object.assign(fixture, recorded); });
}

async function ledgerLink() {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("sheet").snapshot.state === "ready").toBe(true));
  const ducts0 = f.owner.work()?.revision ?? 0;
  const registry = makeAtomRegistry();
  closes.push(() => registry.dispose());
  const node = f.fans.read("sheet-ledger");
  if (!isValidElement(node)) throw Error("The Ledger did not draw");
  render(<RegistryContext value={registry}>{node}</RegistryContext>);
  // The fixture's inferred join has no candidate pair, so its fix is ruling the open end capped: /ducts' Work.
  const link = await screen.findByRole("link", { name: /^Fix in \/ducts: end .+ ›$/ });
  // The fix names the end and is no verb on /fans: no button stages it here.
  expect(screen.queryByRole("button", { name: /for inferred-join$/ })).toBeNull();
  const href = new URL(link.getAttribute("href")!, "http://pe.local");
  expect(href.pathname).toBe("/ducts");
  const selected = JSON.parse(href.searchParams.get("selected") ?? "[]") as { kind: string; id: string }[];
  return { f, href, selected, ducts0 };
}

test("a Fans Ledger fix is a link that lands on /ducts with its element selected", async () => {
  const element = snapshot.nodes.find((n) => n.kind === "equipment")!;
  pointBlocker({ elementId: element.id, subject: elementSubject(element) });
  const { f, href, ducts0 } = await ledgerLink();
  // Arrive on /ducts with that link's search: the blocker's element is the selection.
  const arrived = f.mount(f.admitted.owner, href.searchParams, "ducts-arrival");
  const selected = arrived.native.page.read().selected as readonly { kind: string; id: string }[];
  expect(selected).toHaveLength(1);
  expect(selected.map((s) => s.id)).toEqual([elementKey(element.uniqueId)]);
  // Following the link wrote nothing: /ducts Work is where it was.
  expect(f.owner.work()?.revision ?? 0).toBe(ducts0);
});

/*
 * Slice 5 (79042ced) deleted ElementId keys: a blocker whose element is off /ducts' walk read
 * links by the UniqueId its producer stamped, never by ElementId.
 */
test("a blocker off the walk links with its producer's UniqueId SubjectRef", async () => {
  const subject = elementSubject({ uniqueId: "cd545b04-afd3-4993-836f-9b3d8116003a-00dee3cc" });
  pointBlocker({ elementId: 14122436, subject });
  expect(snapshot.nodes.some((n) => n.id === 14122436)).toBe(false);
  const { selected } = await ledgerLink();
  expect(selected).toEqual([{ kind: "focus", id: subject }]);
});

test("a blocker with no UniqueId opens /ducts on its systems, never a raw ElementId", async () => {
  pointBlocker({ elementId: 14122436 });
  const { href, selected } = await ledgerLink();
  expect(selected).toEqual([]);
  expect(href.searchParams.get("system")).toBeTruthy();
  expect(href.search).not.toContain("14122436");
});

test("the 369-system handoff stays short and resolves to the old roster scope", async () => {
  const recorded = snapshot.systems;
  snapshot.systems = Array.from({ length: 369 }, (_, id) => ({
    ...recorded[0]!, id, name: `System ${id} with a long model-specific name`,
  }));
  closes.push(() => { snapshot.systems = recorded; });
  const { href } = await ledgerLink();
  expect(href.href.length).toBeLessThan(2048);
  const scope = namesOf(fields.system.schema.parse(JSON.parse(href.searchParams.get("system")!)));
  expect(scope).toBe("all");
  // /ducts' network read resolves "all" against its canonical system roster.
  const resolved = scope === "all" ? snapshot.systems.map(system => system.name) : scope;
  expect(resolved).toEqual(calcSystems(snapshot));
  const named = new URL(ductsLink([snapshot.systems[0]!.name], {}), "http://pe.local");
  expect(namesOf(fields.system.schema.parse(JSON.parse(named.searchParams.get("system")!))))
    .toEqual([snapshot.systems[0]!.name]);
});
