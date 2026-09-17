// @vitest-environment jsdom
/**
 * The member editor's Pea lane: the member Work's verbs and refusals (what `settings/manifest.ts`
 * used to prove), and the lane drawn from a demo member's seeded fields with no host.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { SettingsRouteDocument } from "@pe/agent-contracts";

vi.mock("#/host/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/host/client")>()),
  callHostRpc: (key: string) => Promise.reject(new Error(`no host in test: ${key}`)),
}));

import { familyDemoFields } from "#/family/store";
import { familyFixtures } from "#/family/authored-families";

import { DEMO_SPEC, DEMO_SPEC_PATH } from "./seeds";
import { SpecEditor, memberWorkManifest, seededWork } from "./spec-editor";

afterEach(cleanup);

const member = { pod: "mech-standards", path: DEMO_SPEC_PATH };
const ctx = (doc: SettingsRouteDocument | null) =>
  ({ work: { doc, revision: 0 }, page: {}, readings: {} }) as never;

describe("the member Work", () => {
  const { actions } = memberWorkManifest();

  it("opens any member, and refuses save and adopt until a basis is adopted", () => {
    const empty: SettingsRouteDocument = { basis: null, fields: {} };
    expect(actions!.open.ready(ctx(empty), undefined as never)).toBeNull();
    expect(actions!.save.ready(ctx(empty), undefined as never)).toBe("open a pod member first");
    expect(actions!.adopt.ready(ctx(empty), undefined as never)).toBe("open a pod member first");
    const unstamped = { basis: { member, rawContent: "{}", sha256: "" }, fields: {} };
    expect(actions!.save.ready(ctx(unstamped), undefined as never)).toBe(
      "review an adopted member before saving",
    );
  });

  it("leaves mutation to a person", () => {
    expect(actions!.save.actor).toBe("human");
    expect(actions!.adopt.actor).toBe("human");
    expect(actions!.open.actor).toBe("any");
  });

  it("seeds the demo lane from a fixture's bytes and fields, and nothing without fields", () => {
    expect(seededWork(member, DEMO_SPEC)).toMatchObject({
      basis: { member, rawContent: DEMO_SPEC.content },
      fields: DEMO_SPEC.fields,
    });
    expect(seededWork(member, { content: "{}", schema: "" })).toBeUndefined();
    expect(seededWork(null, DEMO_SPEC)).toBeUndefined();
  });

  it("seeds a family fixture on real parameter pointers", () => {
    const fields = familyDemoFields(familyFixtures.refline);
    expect(Object.keys(fields)).toEqual([
      "/parameters/_conn reach/value",
      "/parameters/_conn size/value",
    ]);
    expect(
      Object.values(fields).map((field) => [field.staged != null, field.proposal != null]),
    ).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});

describe("the editor's Pea lane", () => {
  it("shows a demo member's proposal and staged fields with their counts", async () => {
    window.history.replaceState({}, "", "/pods?demo=browse");
    render(<SpecEditor member={member} schema={null} fixture={DEMO_SPEC} />);
    expect(await screen.findByText("1 proposed")).toBeTruthy();
    expect(screen.getByText("2 staged")).toBeTruthy();
    expect(screen.getByText("/ViewTemplateName")).toBeTruthy();
    expect(screen.getByText("Schedule - PE Standard v2")).toBeTruthy();
    expect(screen.getByRole("button", { name: /save 2 staged/i })).toBeTruthy();
  });

  it("draws no lane for a clean member", () => {
    window.history.replaceState({}, "", "/pods?demo=browse");
    render(
      <SpecEditor member={member} schema={null} fixture={{ ...DEMO_SPEC, fields: undefined }} />,
    );
    expect(screen.queryByText(/proposed$/)).toBeNull();
  });
});
