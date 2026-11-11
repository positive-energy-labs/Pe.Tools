// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { elementKey } from "@pe/kit/lang/attention";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { attentionSubjects } from "../ducts/cell-focus";
import { ductElements } from "../ducts/identity";
import { snapshot } from "../ducts/test-fixture";
import sheetFixture from "../ducts/sheet/sheet.fixture.json";
import { makeAtomRegistry } from "../shell/owner";
import { createWitness } from "./cutover.test-support";

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
  await vi.waitFor(() => expect(f.fans.readingStatus("sheet").snapshot.current).toBe(true));
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
  expect([...attentionSubjects(selected.map((s) => s.id), ductElements(snapshot))]).toEqual([elementKey(element.uniqueId)]);
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
