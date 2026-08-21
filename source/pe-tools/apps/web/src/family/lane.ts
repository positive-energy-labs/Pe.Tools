/**
 * /family — WHICH LANE THE PAGE IS ON, decided in one place.
 *
 * The surface has exactly two lanes and the difference between them is a single question: is a
 * family document OPEN in `route:settings`?
 *
 *   LIVE     — yes. Its `rawContent` is parsed, projected (`project.ts`) and built into the page
 *              world. Every value on the page is that document's; save writes back through the
 *              settings lifecycle; the head names the document and its version token.
 *   FIXTURE  — no. `FIXTURE_WORLD`, DECLARED rather than fallen back to, wearing the dashed seam
 *              chip that says exactly what would replace it. Save stays page-local.
 *
 * A THIRD OUTCOME IS NOT A LANE, IT IS AN ERROR. A document that is open but will not parse must
 * never silently become the fixture — the page would then be showing a fan coil while claiming to
 * edit your file. `parseError` carries the parser's own words and the surface says so instead.
 *
 * Nothing here renders. The hook is the seam: the workspace reads a `FamilyLane` and never asks
 * whether a host exists.
 */
import { useMemo } from "react";

import type { FamilyModel } from "#/family/family-model";
import { type FamilyStore, useLiveFamilyStore } from "#/family/host";
import { FIXTURE_WORLD, type PageWorld, buildPageWorld } from "#/family/model";
import { projectFamilyModel } from "#/family/project";

export interface OpenFamilyDocument {
  /** The parsed document — the reverse projection's input, and the authority on its own paths. */
  model: FamilyModel;
  relativePath: string;
  versionToken: string | null;
  /** true when the evidence on the sibling slice describes an OLDER revision of this document. */
  evidenceStale: boolean;
}

export interface FamilyLane {
  world: PageWorld;
  /** null → the declared fixture lane. */
  document: OpenFamilyDocument | null;
  /** Set only when a family document IS open and its raw content will not parse. */
  parseError: string | null;
  store: FamilyStore;
  /**
   * A stable identity for "which document, at which revision" — the page re-seeds its draft when
   * this changes and only then, so a save (which bumps the token) lands the written values and an
   * unrelated re-render does not throw away work in progress.
   */
  seedKey: string;
}

/**
 * THE STALENESS LAW, as a function rather than an expression, because phase D gave it two writers.
 *
 * Evidence stamped with a DIFFERENT token describes a revision you are no longer editing. Equal
 * tokens, and an UNSTAMPED read, claim nothing either way — `capture_evidence` reads out of Revit
 * rather than out of a document and therefore has no revision to stamp, so `null` must never be
 * treated as fresh OR as stale (see `family-commands.ts`: "the nulls are the truth").
 *
 * Both crossings clear staleness the same way and for the same reason: they replace the stamp. A
 * build stamps the revision it read; a capture stamps null. Neither is special-cased.
 */
export function isEvidenceStale(
  evidenceToken: string | null | undefined,
  documentToken: string | null,
): boolean {
  return evidenceToken != null && documentToken != null && evidenceToken !== documentToken;
}

export function useFamilyLane(): FamilyLane {
  const store = useLiveFamilyStore();
  const { snapshot, evidence } = store;

  const parsed = useMemo(() => {
    if (!snapshot) return null;
    try {
      const model = JSON.parse(snapshot.rawContent) as FamilyModel;
      // The one shape check worth making here: everything downstream indexes these two, and a JSON
      // file that parses but is not a family model would fail deeper and less legibly.
      if (model?.familyParameters == null || model.types == null)
        throw new Error("no familyParameters/types — this is valid JSON but not a family model");
      return { model, error: null as string | null };
    } catch (error) {
      return {
        model: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [snapshot]);

  const model = parsed?.model ?? null;
  const relativePath = snapshot?.documentId.relativePath ?? "";
  const versionToken = snapshot?.versionToken ?? null;

  const world = useMemo(
    () =>
      model
        ? buildPageWorld(projectFamilyModel(model, evidence, { path: relativePath }))
        : FIXTURE_WORLD,
    [model, evidence, relativePath],
  );

  return {
    world,
    document: model
      ? {
          model,
          relativePath,
          versionToken,
          evidenceStale: isEvidenceStale(evidence?.from.documentVersionToken, versionToken),
        }
      : null,
    parseError: parsed?.error ?? null,
    store,
    seedKey: model ? `${relativePath}@${versionToken ?? ""}` : "fixture",
  };
}
