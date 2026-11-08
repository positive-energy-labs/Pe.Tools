import type { CandidateRegion } from "./takeoffs.ts";

export function readZoneMeta(blob: string): { view: string; name: string; systemTag: string } {
  const parsed = JSON.parse(blob) as { view?: string; name?: string; systemTag?: string };
  if (!parsed.view || !parsed.name)
    throw new Error("Zoning Region provenance is missing view or name");
  return { view: parsed.view, name: parsed.name, systemTag: parsed.systemTag ?? "" };
}

export interface AdoptDraft {
  readonly region: CandidateRegion;
  readonly view: string;
  readonly checked: boolean;
  readonly name: string;
  readonly systemTag: string;
}

/** A stamped designer region carries provenance; an unstamped one is named from the view. */
export function adoptDrafts(
  candidates: readonly CandidateRegion[],
  patches: Readonly<Record<string, Partial<AdoptDraft>>>,
): readonly AdoptDraft[] {
  return candidates.map((region) => {
    const meta = region.role === "zoning-region" ? readZoneMeta(region.blob) : null;
    return {
      region,
      view: region.view,
      checked: region.role === "zoning-region",
      name: meta?.name || region.typeName || `${region.view} · ${region.elementId}`,
      systemTag: meta?.systemTag ?? "",
      ...patches[`${region.view}:${region.elementId}`],
    };
  });
}
