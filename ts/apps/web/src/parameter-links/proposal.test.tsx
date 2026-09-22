// @vitest-environment jsdom
/**
 * Mission 11: Parameter Links Work = { profile: trichotomy cell }. Pea's proposed profile is drawn
 * in the band grammar (accept stages, deny clears); a preview of it is labelled and never arms
 * apply; the person's own save still stages.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type {
  ParameterLinkProfile,
  ParameterLinksDocument,
  ParameterLinksReading,
} from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { blankAssignment, blankDefinition } from "#/parameter-links/model";
import { ParameterLinksWorkspace } from "#/routes/parameter-links";

vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));
vi.mock("#/readings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/readings")>()),
  useFieldOptionsQuery: () => ({ data: undefined, isPending: false, error: undefined }),
}));

afterEach(cleanup);

const profile = (defs: number): ParameterLinkProfile =>
  ({
    schemaVersion: 1,
    definitions: Array.from({ length: defs }, (_, i) => blankDefinition(`def-${i}`)),
    assignments: [],
  }) as unknown as ParameterLinkProfile;
const PROPOSED = profile(2);

function Harness({
  initial,
  reading = null,
}: {
  initial: ParameterLinksDocument;
  reading?: ParameterLinksReading | null;
}) {
  const [work, setWork] = useState({ doc: initial, revision: 5 });
  const route = {
    work: {
      ...work,
      current: true,
      write: async (patches: { path: (string | number)[]; value?: unknown }[]) => {
        writes.push(patches);
        setWork((current) => {
          const doc = structuredClone(current.doc) as ParameterLinksDocument;
          for (const { path, value } of patches) {
            const cell = doc.profile as Record<string, unknown>;
            if (value === undefined || value === null) delete cell[String(path[1])];
            else cell[String(path[1])] = value;
          }
          return { doc, revision: current.revision + 1 };
        });
        return null;
      },
    },
    actions: {
      refresh: { run: vi.fn(), refusal: null },
      preview: { run: vi.fn(), refusal: null },
      previewProposal: { run: vi.fn(), refusal: null },
      apply: { run: vi.fn(), refusal: null },
    },
    busy: null,
    failure: null,
  };
  return (
    <ParameterLinksWorkspace
      documentAddress={"C:/m/projectA.rvt" as never}
      route={route as never}
      connected
      reading={reading}
      readingId={reading?.evaluated ? "r-1" : null}
      fieldOptionsEnabled={false}
    />
  );
}
let writes: { path: (string | number)[]; value?: unknown }[][] = [];

test("Pea's proposed profile shows inline; accept stages it", async () => {
  writes = [];
  render(
    <Harness initial={{ profile: { proposal: { value: PROPOSED } } } as ParameterLinksDocument} />,
  );
  expect(screen.getByText(/pea proposes/)).toBeTruthy();
  expect(document.body.textContent).toContain("2 definitions · 0 assignments");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "accept" })));
  expect(writes.flat().some((p) => p.path.join(".") === "profile.staged")).toBe(true);
  expect(screen.queryByText(/pea proposes/)).toBeNull();
});

test("deny clears Pea's proposed profile", async () => {
  writes = [];
  render(
    <Harness initial={{ profile: { proposal: { value: PROPOSED } } } as ParameterLinksDocument} />,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "deny" })));
  expect(screen.queryByText(/pea proposes/)).toBeNull();
  expect(writes.flat().some((p) => p.path.join(".") === "profile.staged")).toBe(false);
});

test("a preview of Pea's proposal is labelled, and apply refuses it in the host's words", () => {
  const reading = {
    basis: "proposal:x",
    workRevision: 5,
    evaluated: true,
    subject: "proposal",
    stored: null,
    status: { updaterRegistered: false, activeDefinitionCount: 0, activeAssignmentCount: 0 },
    evaluation: {
      sourceElementCount: 0,
      targetElementCount: 0,
      changedWriteCount: 1,
      writes: [],
      issues: [],
    },
    profileChanged: false,
    appliedWriteCount: 0,
  } as unknown as ParameterLinksReading;
  render(
    <Harness
      initial={
        {
          profile: { proposal: { value: PROPOSED }, staged: { value: profile(1) } },
        } as ParameterLinksDocument
      }
      reading={reading}
    />,
  );
  expect(document.body.textContent).toContain("preview of Pea's proposal — not staged");
  expect(document.body.textContent).toContain(
    "The reviewed reading is a proposal preview; stage the profile and preview again",
  );
});

test("saving your own profile still stages it", async () => {
  writes = [];
  render(<Harness initial={{ profile: {} } as ParameterLinksDocument} />);
  await act(async () =>
    fireEvent.click(screen.getAllByRole("button", { name: /add definition/ })[0]!),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /save draft/ })));
  expect(writes.flat().some((p) => p.path.join(".") === "profile.staged")).toBe(true);
});

test("the proposal row expands into a per-definition and per-assignment diff against staged", async () => {
  const stagedProfile = {
    formatVersion: 1,
    definitions: [blankDefinition("def-0"), blankDefinition("def-2")],
    assignments: [blankAssignment("def-0", "a-1")],
  } as ParameterLinkProfile;
  const proposed = {
    formatVersion: 1,
    definitions: [{ ...blankDefinition("def-0"), reducer: "max" }, blankDefinition("def-1")],
    assignments: [
      { ...blankAssignment("def-0", "a-1"), enabled: false },
      blankAssignment("def-1", "a-2"),
    ],
  } as ParameterLinkProfile;
  render(
    <Harness
      initial={
        {
          profile: { proposal: { value: proposed }, staged: { value: stagedProfile } },
        } as ParameterLinksDocument
      }
    />,
  );
  const disclosure = screen.getByLabelText("changes against staged");
  expect(disclosure.textContent).toBe("5 changes against staged");
  await act(async () => fireEvent.click(disclosure));
  const change = (key: string) =>
    document.querySelector(`[data-key="${key}"]`)?.textContent ?? `no row ${key}`;
  expect(change("definition:def-0")).toContain("changed: reducer");
  expect(change("definition:def-1")).toContain("added");
  expect(change("definition:def-2")).toContain("removed");
  expect(change("assignment:a-1")).toContain("changed: enabled");
  expect(change("assignment:a-2")).toContain("added");
});

test("with nothing staged every proposed definition and assignment reads added", () => {
  render(
    <Harness initial={{ profile: { proposal: { value: PROPOSED } } } as ParameterLinksDocument} />,
  );
  expect(screen.getByLabelText("changes against staged").textContent).toBe(
    "2 changes against staged",
  );
});
