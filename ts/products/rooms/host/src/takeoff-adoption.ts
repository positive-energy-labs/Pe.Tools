export function readZoneMeta(blob: string): { view: string; name: string; systemTag: string } {
  const parsed = JSON.parse(blob) as { view?: string; name?: string; systemTag?: string };
  if (!parsed.view || !parsed.name)
    throw new Error("Zoning Region provenance is missing view or name");
  return { view: parsed.view, name: parsed.name, systemTag: parsed.systemTag ?? "" };
}
