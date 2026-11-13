import { basename, dirname } from "node:path";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { journalKind } from "../src/action-journal.ts";
import { scheduledTasksKind } from "../src/scheduled-tasks.ts";
import { updateAdmissionKind } from "../src/update-reader.ts";
import { ledgerKind } from "../src/installed-pods.ts";
import { homeKind, stateKind } from "@pe/host-contracts/kinds";
import { z } from "zod";

export const journalFixture = (path: string) =>
  journalKind.in(stateFixture(dirname(path)), basename(path));
export const scheduleFixture = (path: string) =>
  scheduledTasksKind.in(stateFixture(dirname(path)), basename(path));
export const updateFixture = (path: string) =>
  updateAdmissionKind.in(stateFixture(dirname(path)), basename(path));
export const ledgerFixture = (path: string) =>
  ledgerKind.in(stateFixture(dirname(path)), basename(path));
const authoredKind = homeKind({
  schema: z.unknown(),
  place: (name: string) => `Authored fixture ${name}`,
  segments: (name: string) => [name],
});
export const authoredFixture = (path: string) =>
  authoredKind.in(
    { root: dirname(path), tier: "user", machine: stateFixture(dirname(path)).machine },
    basename(path),
  );
const artifactKind = stateKind({
  schema: z.unknown(),
  place: (name: string) => `Artifact fixture ${name}`,
  segments: (name: string) => [name],
});
export const artifactFixture = (path: string) =>
  artifactKind.in(stateFixture(dirname(path)), basename(path));
