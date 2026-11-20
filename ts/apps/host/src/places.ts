import { watchFile, unwatchFile } from "node:fs";
import { placesFileSchema, type PlacesFile } from "../../../packages/agent-contracts/src/places.ts";
import { read, stateKind, writeState, type Kind, type StateRoot } from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";
import { leaf, read as graphRead } from "@pe/host-internal/read-graph";
import { z } from "zod";

export const placesKind: Kind<PlacesFile, "state", []> = stateKind({
  place: () => "Places",
  schema: placesFileSchema,
  segments: () => ["places.json"],
});
export function readPlaces(root: StateRoot = hostState()): PlacesFile {
  const saved = read(placesKind.in(root));
  return saved.kind === "ok" ? saved.value : { places: [] };
}
export function writePlaces(value: PlacesFile, root: StateRoot = hostState()): PlacesFile {
  const next = placesFileSchema.parse(value);
  // Read first so the kernel preserves undecodable or unreadable prior bytes before replacement.
  readPlaces(root);
  writeState(placesKind.in(root), JSON.stringify(next));
  for (const changed of listeners) changed();
  return next;
}
const listeners = new Set<() => void>();
export function subscribePlaces(changed: () => void, root: StateRoot = hostState()): () => void {
  listeners.add(changed);
  const file = placesKind.in(root).path;
  watchFile(file, { interval: 500, persistent: false }, changed);
  return () => {
    listeners.delete(changed);
    unwatchFile(file, changed);
  };
}
const placesInput = leaf("places", z.object({}), placesFileSchema);
export const placesRead = graphRead("places", {
  input: z.object({}),
  output: placesFileSchema,
  run: (ctx, args) => ctx.read(placesInput, args),
});
