// @vitest-environment jsdom
/**
 * Slice 6 falsifier, consent in two places (ADR 0035 rule 6): the write button that asked, and one
 * `ConsentSweep` on web (the topbar) and in the tray card. The composer `ArmingStrip` and both
 * Timeline-head consent branches are gone.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { TimelineHead, type JournalOwner } from "./situation-band";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";

vi.mock("#/workbench/provider/harness-client", () => ({
  harnessClient: () => ({ permission: vi.fn(async () => ({})) }),
}));
afterEach(cleanup);

const SRC = join(import.meta.dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "node_modules"
        ? []
        : files(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );
const sitesOf = (pattern: RegExp) =>
  files(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file).replaceAll("\\", "/"))
    .sort();

/** The two mounts the contract names: the web topbar and the tray card. */
const SWEEP_SITES = ["machine/notice.tsx", "navigation/app-bar.tsx"];

test("red (slice 6 seam b): one ConsentSweep on web and one in the tray card", () => {
  expect(
    sitesOf(/<ConsentSweep\b/),
    "slice 6 gap: no surface mounts ConsentSweep yet (kit lang/consent-sweep is a stub)",
  ).toEqual(SWEEP_SITES);
});

test("red (slice 6 seam b): the composer draws no ArmingStrip for consent", () => {
  expect(
    sitesOf(/ArmingStrip/).filter((site) => site.startsWith("chat/")),
    "slice 6 gap: chat/composer-pending.tsx still draws run consent as an ArmingStrip",
  ).toEqual([]);
});

test("red (slice 6 seam b): the Timeline head draws no consent window", () => {
  const timeline: JournalOwner = {
    timeline: () => [],
    journal: () => null,
    subscribe: () => () => {},
    revision: () => 0,
    journalRefusal: () => null,
    restoreWork: vi.fn(),
    stopCommand: vi.fn(),
  };
  const ask = {
    requestId: "ask-1",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    scope: "run" as const,
    toolCallId: "writes:1",
    toolName: "writes",
    options: [{ optionId: "stop", name: "Reject", kind: "reject_once" as const }],
  };
  const ui = render(
    <WorkbenchContext.Provider
      value={{ runApprovals: [ask], resolveApproval: vi.fn(async () => {}) } as never}
    >
      <TimelineHead owner={timeline} history={null} thread="t" />
    </WorkbenchContext.Provider>,
  );
  expect(
    ui.container.querySelectorAll("[data-slot='consent-window']").length,
    "slice 6 gap: situation-band.tsx TimelineHead still draws the run-ask and receipt consent branches; the topbar sweep owns them",
  ).toBe(0);
});
