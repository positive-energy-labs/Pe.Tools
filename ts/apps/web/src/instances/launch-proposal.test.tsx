// @vitest-environment jsdom
/**
 * Mission 9: Pea's launch proposal, in the band grammar. It is drawn through the kit's review
 * row ("pea proposes …", accept / deny from the contract's transitions); open and start stay
 * refused, by name, until something is staged.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { InstancesDocument } from "@pe/agent-contracts";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { InstancesCluster } from "#/instances/cluster";
import type { InstancesFleet } from "#/instances/workspace";
import { INSTANCES_WORK, instancesManifest, type InstancesHandle } from "#/instances/manifest";

vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: vi.fn(async () => ({ id: "test", state: "succeeded" })),
}));
vi.mock("#/actions/receipt", () => ({ ActionReceipts: () => null }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useSearch: () => ({}),
}));
vi.mock("#/readings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/readings")>()),
  readReading: vi.fn(async () => ({ result: {} })),
}));

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const PROPOSED = { kind: "start", year: "2025", name: "dev" } as const;
const fleet: InstancesFleet = {
  sessions: [],
  worlds: [],
  unreadableReceipts: [],
  processReadErrors: [],
  registryRoot: "C:\registry",
  isLoading: false,
  stale: false,
  error: null,
  basis: ["test"],
};

function Harness() {
  const [work, setWork] = useState({
    doc: { launch: { proposal: { value: PROPOSED } } } as InstancesDocument,
    revision: 3,
  });
  const handle = {
    manifest: instancesManifest,
    work: {
      key: INSTANCES_WORK,
      doc: work.doc,
      revision: work.revision,
      current: true,
      write: async (patches: { path: (string | number)[]; value?: unknown }[]) => {
        setWork((current) => {
          const doc = structuredClone(current.doc) as InstancesDocument;
          for (const { path, value } of patches) {
            const launch = doc.launch as Record<string, unknown>;
            if (value === undefined || value === null) delete launch[String(path[1])];
            else launch[String(path[1])] = value;
          }
          return { doc, revision: current.revision + 1 };
        });
        return null;
      },
    },
    failure: null,
  } as InstancesHandle;
  return <InstancesCluster fleet={fleet} target="" setTarget={() => {}} handle={handle} />;
}

const proposalRow = () => screen.queryByText(/pea proposes/);

test("Pea's launch proposal is drawn inline with its verbs, and accept stages it", async () => {
  render(<Harness />);
  expect(proposalRow()).not.toBeNull();
  expect(document.body.textContent).toContain("start a new 2025 session");
  // Open/start refuse by name while it is only proposed.
  const start = screen.getByRole("button", { name: /^start/ });
  expect(start.hasAttribute("disabled") || start.getAttribute("aria-disabled") === "true").toBe(
    true,
  );
  expect(start.getAttribute("title") ?? "").toContain(
    "Pea's proposal is not staged; accept it first",
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "accept" })));
  expect(proposalRow()).toBeNull();
  expect(document.body.textContent).toMatch(/staged\s*start a new 2025 session/);
  const staged = screen.getByRole("button", { name: /^start/ });
  expect(staged.hasAttribute("disabled")).toBe(false);
});

test("deny clears Pea's launch proposal and stages nothing", async () => {
  render(<Harness />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "deny" })));
  expect(proposalRow()).toBeNull();
  expect(document.body.textContent).toContain("nothing staged");
});

test("old-shape instances Work fails closed: the host's refusal and start fresh, as families", async () => {
  const startFresh = vi.fn(async () => null);
  const refusal =
    "This route's saved Work is in a shape this version cannot read, so it was left untouched; it cannot be opened here.";
  const handle = {
    manifest: instancesManifest,
    work: {
      key: INSTANCES_WORK,
      doc: null,
      revision: null,
      current: false,
      refusal,
      startFresh,
      write: vi.fn(async () => null),
    },
    failure: null,
  } as unknown as InstancesHandle;
  render(<InstancesCluster fleet={fleet} target="" setTarget={() => {}} handle={handle} />);
  expect(document.body.textContent).toContain(refusal);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "start fresh" })));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "start fresh? press again" })),
  );
  expect(startFresh).toHaveBeenCalledOnce();
});
