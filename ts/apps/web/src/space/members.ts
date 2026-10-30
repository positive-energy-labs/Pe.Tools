import { spaceElementKey, type DocumentRef } from "@pe/agent-contracts";
import type { Psc1Metadata } from "#/scene/psc1";
import type { NativeObservation } from "#/revit/observation";
import type { ReadingState } from "#/shell/readings";
import type { LoadedSpaceScene } from "./sources";
import type { SpacePage } from "./graph";

export function spaceSceneMembers(metadata: Psc1Metadata): ReadonlySet<string> {
  const pair = (documentKey: string, linkInstanceId?: number | null) =>
    JSON.stringify([documentKey, linkInstanceId ?? null]);
  const sources = new Set(
    metadata.sources
      .filter(
        (source) =>
          source.linkInstanceId != null || source.documentKey === metadata.stamp.hostDocumentKey,
      )
      .map((source) => pair(source.documentKey, source.linkInstanceId)),
  );
  return new Set(
    metadata.elements
      .filter((element) =>
        sources.has(pair(element.handle.documentKey, element.handle.linkInstanceId)),
      )
      .map((element) => spaceElementKey(element.handle)),
  );
}

/** URL restoration is forgiving; explicit Page moves are checked by the bound transition. */
export function reconcileSpaceMembers(
  page: SpacePage,
  scene: LoadedSpaceScene,
): Partial<SpacePage> {
  if (page.scene !== scene.id) return {};
  const members = scene.members;
  const patch: Partial<SpacePage> = {};
  if (page.selected !== null && !members.has(page.selected)) patch.selected = null;
  const hidden = page.hidden.filter((key) => members.has(key));
  if (hidden.length !== page.hidden.length) patch.hidden = hidden;
  if (page.isolated !== null) {
    const isolated = page.isolated.filter((key) => members.has(key));
    if (isolated.length !== page.isolated.length) patch.isolated = isolated;
  }
  return patch;
}

/** A durable artifact alone cannot prove which open document lifetime produced it. */
export function spaceObservation(
  page: SpacePage,
  read: ReadingState,
  document: DocumentRef | null,
  capture: {
    scene: string;
    document: DocumentRef;
    stamp: Pick<Psc1Metadata["stamp"], "hostDocumentKey" | "epoch" | "builtUtc" | "fresh">;
  } | null,
): NativeObservation {
  const scene = read.value as LoadedSpaceScene | undefined;
  if (
    page.demo === "fixture" ||
    !read.current ||
    !scene ||
    scene.id !== page.scene ||
    !scene.metadata.stamp.fresh ||
    !capture ||
    capture.scene !== page.scene ||
    !capture.stamp.fresh ||
    capture.stamp.hostDocumentKey !== scene.metadata.stamp.hostDocumentKey ||
    capture.stamp.epoch !== scene.metadata.stamp.epoch ||
    capture.stamp.builtUtc !== scene.metadata.stamp.builtUtc ||
    !document ||
    document.session !== capture.document.session ||
    document.openId !== capture.document.openId
  )
    return { scope: null, references: [] };
  const metadata = scene.metadata;
  return {
    scope: {
      document: capture.document,
      source: "native",
      documentKey: metadata.stamp.hostDocumentKey,
      observationId: scene.id,
    },
    references: metadata.elements
      .filter(
        (e) =>
          e.handle.linkInstanceId == null &&
          e.handle.documentKey === metadata.stamp.hostDocumentKey &&
          scene.members.has(spaceElementKey(e.handle)),
      )
      .map((e) => ({
        elementId: e.handle.elementId,
        uniqueId: e.handle.uniqueId,
        documentKey: e.handle.documentKey,
      })),
  };
}
