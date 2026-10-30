import { readTable } from "../../../../packages/mcps/src/shared/query-client";
import { spaceReads, readSpaceCapture } from "./reads";
import type { ReadingSource, ReadingState } from "#/shell/readings";
import { sceneData } from "#/scene/scene-data";
import type { SceneMeshes } from "#/scene/types";
import type { Psc1Metadata } from "#/scene/psc1";
import { FIXTURE_ANSWERS, FIXTURE_SCENE } from "./fixture";
import type { SpacePage } from "./graph";
import { spaceSceneMembers } from "./members";

export type LoadedSpaceScene = {
  id: string | undefined;
  metadata: Psc1Metadata;
  meshes: SceneMeshes;
  members: ReadonlySet<string>;
};
export const loadedScene = (
  id: string | undefined,
  data: { metadata: Psc1Metadata; meshes: SceneMeshes },
): LoadedSpaceScene => ({ id, ...data, members: spaceSceneMembers(data.metadata) });

export function matchingScene(page: SpacePage, read: ReadingState): LoadedSpaceScene | null {
  const value = read.value as LoadedSpaceScene | undefined;
  return value && value.id === page.scene && (read.status === "ready" || read.status === "stale")
    ? value
    : null;
}

export const spaceSources: Readonly<Record<string, ReadingSource>> = {
  "space.scene": {
    kind: "use",
    open(ctx, deliver) {
      const page = ctx.page as SpacePage;
      if (page.demo === "fixture")
        return deliver({
          kind: "complete",
          value: loadedScene(page.scene, FIXTURE_SCENE),
          revision: 0,
        });
      if (!page.scene) return deliver({ kind: "complete", value: null, revision: 0 });
      // Artifact restoration has no capture branch. The kernel owns this subscription's lifetime.
      const source = sceneData({ kind: "artifact", id: page.scene });
      const publish = () => {
        const snapshot = source.read();
        if (snapshot.state === "pending") deliver({ kind: "pending" });
        else if (snapshot.state === "failed") deliver({ kind: "failure", error: snapshot.error });
        else
          deliver({
            kind: "complete",
            value: loadedScene(page.scene, snapshot.data),
            revision: 1,
            fresh: snapshot.data.metadata.stamp.fresh,
          });
      };
      const release = source.subscribe(publish);
      publish();
      return release;
    },
  },
  "space.demo-answers": {
    kind: "derive",
    derive: ({ page }) => ((page as SpacePage).demo === "fixture" ? FIXTURE_ANSWERS : null),
  },
};

export const spaceQueries = readTable(spaceReads, (key, input, ctx) =>
  readSpaceCapture(key, input, ctx.target.kind === "document" ? ctx.target.ref : undefined),
);
