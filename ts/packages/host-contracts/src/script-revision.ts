import { createHash } from "node:crypto";

export const isCompilerSource = (path: string) => /\.csx?$/i.test(path);
export const isCompilerInput = (path: string) =>
  path === "pod.json" || path === "PeScripts.csproj" || isCompilerSource(path);

/** Commit to every compiler input's exact path and byte digest in canonical path order. */
export function scriptSourceRevision(members: readonly { path: string; sha256: string }[]): string {
  const inputs = members.filter(member => isCompilerInput(member.path))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .map(member => [member.path, member.sha256]);
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

export function scriptSourceBundleRevision(bundle: { files: readonly { path: string; bytesBase64: string }[] }): string {
  return scriptSourceRevision(bundle.files.map(file => ({ path: file.path,
    sha256: createHash("sha256").update(Buffer.from(file.bytesBase64, "base64")).digest("hex") })));
}
