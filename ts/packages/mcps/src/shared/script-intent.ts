import { parseContributionKey } from "@pe/agent-contracts";

/** Compare canonical script identity with sealed source; never reopen a mutable Pod folder. */
export function retainedScriptIntent(
  key: string,
  input: Record<string, unknown>,
  original: Record<string, unknown>,
) {
  const reference = parseContributionKey(key);
  if (reference?.kind !== "script") return undefined;
  const bundle = original.sourceBundle as
    | { files?: { path: string; bytesBase64: string }[] }
    | undefined;
  const manifest = bundle?.files?.find((file) => file.path === "pod.json");
  if (
    !manifest ||
    JSON.parse(decodeCapturedManifest(manifest.bytesBase64)).id !== reference.packageId ||
    original.sourcePath !== reference.path
  )
    throw Error(`Script '${key}' conflicts with its sealed source identity`);
  return { key: "scripting.execute", input: { ...original, ...input } };
}

// Match File.ReadAllText/StreamReader BOM rules for the captured manifest identity.
function decodeCapturedManifest(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const bom = bytes.length >= 4 ? view.getUint32(0) : 0;
  if (bom === 0xfffe0000 || bom === 0x0000feff) {
    if (bytes.length % 4) throw Error("Invalid captured UTF-32 manifest");
    const text: string[] = [];
    for (let i = 4; i < bytes.length; i += 4) {
      const code = view.getUint32(i, bom === 0xfffe0000);
      text.push(
        String.fromCodePoint(
          code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? code : 0xfffd,
        ),
      );
    }
    return text.join("");
  }
  return new TextDecoder(
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8",
  ).decode(bytes);
}
