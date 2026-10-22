/** The PSC1 bytes of one captured scene, by its artifact id (a SHA-256). */
import { hostFetch } from "#/host/runtime";

export async function fetchSceneArtifact(id: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Scene id must be a SHA-256 artifact id");
  // Disk artifacts are durable. Browser HTTP cache and mounted GPU scopes are separate layers.
  const response = await hostFetch(`/pe/space/scenes/${id}/artifact`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw Error(
      `Scene artifact unavailable (${response.status}). Capture it from its document again.`,
    );
  return response.arrayBuffer();
}
