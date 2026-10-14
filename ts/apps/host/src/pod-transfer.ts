/** Transport consumes packages.ts's captured members; source bytes and local custody stay distinct. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { message, packageIdSchema, packageMemberPathSchema } from "@pe/agent-contracts";
import { scriptPodMemberBounds } from "@pe/host-contracts/generated";
import type { PodExport, PodImport, PodPromote } from "@pe/host-contracts/operation-types";
import { hostCaptures, type CaptureStore } from "./captures-route.ts";
import {
  captureDirectory,
  capturePackage,
  isPackageMember,
  listPackages,
  type AdmittedPackage,
  type PackageListing,
} from "./packages.ts";
import { productPagesRootPath, productPodsRootPath } from "./product-paths.ts";
import { activateImportedPackage } from "./package-lifecycle.ts";
import { validatePageHtml, writeArtifact } from "./page-artifacts.ts";

const VENDOR_DIRECTORY = "_vendor";
const IMPORTED_FILE = "imported.json";
const LOCAL_PREFIX = "@local/";
const CAPTURE_REFERENCE = /\/captures\/([0-9a-f]{64})\.png/g;
const CAPTURE_MEMBER = /^captures\/([0-9a-f]{64})\.(png|json)$/;
/** A stored archive of bounded members plus headers; anything larger is refused before it is read. */
const MAX_ARCHIVE_BYTES = scriptPodMemberBounds.maxTotalBytes * 2;

export type TransferOptions = {
  readonly podsRoot?: string;
  readonly pagesRoot?: string;
  readonly captures?: CaptureStore;
};

/** A transport refusal: the archive or pod cannot cross as asked. `status` maps to the HTTP answer. */
export class TransferRefused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 = 422,
  ) {
    super(message);
  }
}

export async function exportPod(
  request: { pod: string; archivePath: string },
  options: TransferOptions = {},
): Promise<PodExport> {
  const archivePath = zipPath(request.archivePath);
  const listing = await listPackages(options.podsRoot ?? productPodsRootPath());
  const pod = unique(listing, request.pod);
  const captured = await capturePackage(pod).catch((error: unknown) => {
    throw new TransferRefused(`Pod '${request.pod}' is not exportable: ${message(error)}`);
  });
  const files = new Map<string, Buffer>(
    captured.members.map((m) => [m.path, Buffer.from(m.bytes)]),
  );
  const transforms: PodExport["transforms"][number][] = [];
  const record = (
    path: string,
    transform: PodExport["transforms"][number]["transform"],
    after: Buffer,
  ) => {
    const before = files.get(path)!;
    if (before.equals(after)) return;
    transforms.push({ path, transform, beforeSha256: sha256(before), afterSha256: sha256(after) });
    files.set(path, after);
  };

  const project = files.get("PeScripts.csproj");
  if (project) record("PeScripts.csproj", "portable-project", portableProject(project));
  const vendored = vendor(pod.id, files, listing, record);
  const captures = await closeCaptures(files, options.captures ?? hostCaptures());

  bounded([...files].map(([path, bytes]) => ({ path, bytes })));
  const archive = writeZip(files);
  await writeArtifact(dirname(archivePath), archivePath, archive, true);
  return {
    id: pod.id,
    archivePath,
    archiveSha256: sha256(archive),
    members: [...files].sort(byPath).map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
    vendored,
    transforms,
    captures,
  };
}

/**
 * Rewrites foreign directive references in this pod's settings and adds each consumed fragment,
 * transitively. A vendored fragment stays byte-identical unless it carries references of its own.
 */
function vendor(
  podId: string,
  files: Map<string, Buffer>,
  listing: PackageListing,
  record: (
    path: string,
    transform: PodExport["transforms"][number]["transform"],
    after: Buffer,
  ) => void,
): PodExport["vendored"] {
  const vendored: PodExport["vendored"][number][] = [];
  const pending: { owner: string; path: string }[] = [];
  // owner is null for this pod's own members; otherwise the vendored fragment's pod (its `@local`).
  const rewrite = (source: string, bytes: Buffer, owner: string | null): Buffer => {
    let root: unknown;
    try {
      root = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
    } catch (error) {
      throw new TransferRefused(
        `Cannot publish '${source}': it is not valid JSON (${message(error)}).`,
      );
    }
    let changed = false;
    for (const holder of directiveHolders(root)) {
      const reference = parseReference(holder.value[holder.key] as string, source);
      const foreign =
        reference.id === "local"
          ? owner
          : reference.id === podId && owner === null
            ? null
            : reference.id;
      if (foreign === null) continue;
      pending.push({ owner: foreign, path: reference.path });
      holder.value[holder.key] =
        LOCAL_PREFIX + vendorPath(foreign, reference.path).slice("settings/".length);
      changed = true;
    }
    return changed ? Buffer.from(`${JSON.stringify(root, null, 2)}\n`) : bytes;
  };

  for (const path of [...files.keys()].filter(isSettingsJson))
    record(path, "vendor-references", rewrite(path, files.get(path)!, null));
  for (let next = pending.shift(); next; next = pending.shift()) {
    const target = vendorPath(next.owner, next.path);
    if (files.has(target)) continue;
    const bytes = unique(listing, next.owner).members.find((m) => m.path === next.path)?.bytes;
    if (!bytes)
      throw new TransferRefused(
        `Cannot publish: pod '${next.owner}' has no member '${next.path}'.`,
      );
    files.set(target, rewrite(`@${next.owner}/${next.path}`, Buffer.from(bytes), next.owner));
    vendored.push({ id: next.owner, path: next.path, sha256: sha256(Buffer.from(bytes)) });
  }
  return vendored;
}

type Holder = { value: Record<string, unknown>; key: "$include" | "$preset" };
function directiveHolders(token: unknown): Holder[] {
  if (Array.isArray(token)) return token.flatMap(directiveHolders);
  if (!token || typeof token !== "object") return [];
  const value = token as Record<string, unknown>;
  return Object.entries(value).flatMap(([key, child]) =>
    (key === "$include" || key === "$preset") && typeof child === "string"
      ? [{ value, key } as Holder]
      : directiveHolders(child),
  );
}

/** `@local/<path>` or `@<pod-id>/<path>`, always naming a `settings/` JSON member. */
function parseReference(text: string, source: string): { id: string; path: string } {
  const match = /^@([^/]+)\/(.+)$/.exec(text);
  const relative = match?.[2]?.replaceAll("\\", "/") ?? "";
  if (
    !match ||
    (match[1] !== "local" && !packageIdSchema.safeParse(match[1]).success) ||
    relative.startsWith("/") ||
    relative.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new TransferRefused(
      `Cannot publish '${source}': directive reference '${text}' is not a safe '@local/<path>' or '@<pod-id>/<path>' reference.`,
    );
  return {
    id: match[1]!,
    path: `settings/${/\.json$/i.test(relative) ? relative : `${relative}.json`}`,
  };
}

const vendorPath = (podId: string, settingsPath: string) =>
  `settings/${VENDOR_DIRECTORY}/${podId}/${settingsPath.slice("settings/".length)}`;
const isSettingsJson = (path: string) => /^settings\/.+\.json$/i.test(path);

/** Every capture a text member names travels by hash; one this host does not hold refuses export. */
async function closeCaptures(files: Map<string, Buffer>, store: CaptureStore): Promise<string[]> {
  const named = new Map<string, string>();
  for (const [path, bytes] of files) {
    if (CAPTURE_MEMBER.test(path)) continue;
    for (const match of bytes.toString("utf8").matchAll(CAPTURE_REFERENCE))
      if (!named.has(match[1]!)) named.set(match[1]!, path);
  }
  const receipts = named.size ? await store.list() : [];
  for (const [sha, path] of named) {
    if (files.has(`captures/${sha}.png`)) continue;
    const blob = await store.blob(sha);
    if (!blob)
      throw new TransferRefused(
        `Cannot publish: '${path}' names capture ${sha}, which this host does not hold.`,
      );
    files.set(`captures/${sha}.png`, blob);
    const receipt = receipts.find((r) => r.sha === sha);
    if (receipt && !files.has(`captures/${sha}.json`))
      files.set(`captures/${sha}.json`, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  }
  return [...named.keys()].sort();
}

export async function importPod(
  request: { archivePath: string; folder?: string },
  options: TransferOptions = {},
): Promise<PodImport> {
  const archivePath = zipPath(request.archivePath);
  const info = await stat(archivePath).catch(() => null);
  if (!info?.isFile()) throw new TransferRefused(`No pod archive at ${archivePath}.`, 404);
  if (info.size > MAX_ARCHIVE_BYTES)
    throw new TransferRefused(`Pod archive exceeds ${MAX_ARCHIVE_BYTES} bytes.`);
  const archive = await readFile(archivePath);
  return installArchive(archive, archivePath, request.folder, options);
}

/** Install one archive's bytes; `locator` is provenance only. Shared by import and first boot. */
export async function installArchive(
  archive: Buffer,
  locator: string,
  folderName: string | undefined,
  options: TransferOptions = {},
): Promise<PodImport> {
  const entries = readZip(archive);
  const id = archiveId(entries);
  const folder = localFolder(folderName ?? id);
  const podsRoot = options.podsRoot ?? productPodsRootPath();
  const installed = (await listPackages(podsRoot)).packages.find((p) => p.id === id);
  if (installed)
    throw new TransferRefused(
      `Pod id '${id}' is already installed in folder '${installed.folder}'.`,
      409,
    );
  const directory = join(podsRoot, folder);
  if (await lstat(directory).catch(() => null))
    throw new TransferRefused(`Pod folder already exists: ${directory}`, 409);
  for (const [path, bytes] of entries) {
    if (/^pages\/[^/]+\/index\.html$/.test(path)) validatePageHtml(bytes.toString("utf8"), true);
    const sha = CAPTURE_MEMBER.exec(path);
    if (sha?.[2] === "png" && sha256(bytes) !== sha[1])
      throw new TransferRefused(`Archive member '${path}' does not hash to its name.`);
  }

  const archiveSha256 = sha256(archive);
  // Staged in a dot-folder of the pods root: listings skip it, and the final move is one rename.
  const staging = join(podsRoot, `.importing-${randomUUID()}`);
  try {
    for (const [path, bytes] of entries) {
      await writeArtifact(staging, join(staging, folder, path), bytes);
    }
    await writeArtifact(
      staging,
      join(staging, folder, IMPORTED_FILE),
      `${JSON.stringify({ archiveSha256, locator, date: new Date().toISOString() }, null, 2)}\n`,
    );
    const admitted = (await listPackages(staging)).packages[0];
    if (!admitted || admitted.id !== id)
      throw new TransferRefused(`Pod archive '${locator}' is not an admissible pod.`);
    await rename(join(staging, folder), directory);
    const store = options.captures ?? hostCaptures();
    for (const [path, bytes] of entries)
      if (CAPTURE_MEMBER.exec(path)?.[2] === "png") await store.adopt(bytes);
    await activateImportedPackage(id, podsRoot);
    return {
      id,
      folder,
      directory,
      archiveSha256,
      members: admitted.members.map((m) => ({ path: m.path, sha256: m.sha256 })),
      diagnostics: admitted.diagnostics,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The manifest id an archive claims; refuses an archive without a valid, unreserved one. */
export function archiveId(entries: ReadonlyMap<string, Buffer>): string {
  const manifest = entries.get("pod.json");
  if (!manifest)
    throw new TransferRefused("Pod archive must contain pod.json at the archive root.");
  let id: unknown;
  try {
    id = (JSON.parse(manifest.toString("utf8").replace(/^﻿/, "")) as { id?: unknown }).id;
  } catch (error) {
    throw new TransferRefused(`Pod archive has an invalid pod.json: ${message(error)}`);
  }
  const parsed = packageIdSchema.safeParse(id);
  if (!parsed.success)
    throw new TransferRefused(
      `Pod archive pod.json names no valid, unreserved id (${String(id)}).`,
    );
  return parsed.data;
}

/**
 * Wrap a scratch Page (`Pages/<page>/`) as a new Pod `<id>` holding `pages/<page>/`, byte for byte.
 * The scratch Page stays; its binding does not travel (the promoted Page starts unbound).
 */
export async function promotePage(
  request: { page: string; id: string; name?: string },
  options: TransferOptions = {},
): Promise<PodPromote> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.page))
    throw new TransferRefused(`'${request.page}' is not a scratch Page slug.`, 400);
  const id = packageIdSchema.safeParse(request.id);
  if (!id.success)
    throw new TransferRefused(`'${request.id}' is not a valid, unreserved pod id.`, 400);
  const source = join(options.pagesRoot ?? productPagesRootPath(), request.page);
  if (!(await lstat(join(source, "index.html")).catch(() => null))?.isFile())
    throw new TransferRefused(`No scratch Page '${request.page}' (no index.html).`, 404);
  const page = await captureDirectory(source);
  const errors = page.diagnostics.filter((d) => d.severity === "error");
  if (errors.length)
    throw new TransferRefused(errors.map((d) => `${d.path}: ${d.message}`).join("; "));
  const manifest = Buffer.from(
    `${JSON.stringify({ schemaVersion: 2, id: id.data, name: request.name ?? request.page, version: "0.1.0", entrypoints: [] }, null, 2)}\n`,
  );
  const files = new Map<string, Buffer>([["pod.json", manifest]]);
  for (const member of page.members)
    files.set(`pages/${request.page}/${member.path}`, Buffer.from(member.bytes));
  const installed = await installArchive(writeZip(files), source, id.data, options);
  return { ...installed, key: `page:@${installed.id}/pages/${request.page}` };
}

const DOS_DATE = (1 << 5) | 1; // 1980-01-01: archives hash the same for the same bytes.
const UTF8_FLAG = 0x0800;

export function writeZip(files: ReadonlyMap<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [path, bytes] of [...files].sort(byPath)) {
    const name = Buffer.from(path, "utf8");
    const data = deflateRawSync(bytes);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * Read a pod archive under the membership bounds: every entry must be an admissible package member
 * (no host state, traversal, links or case twins), inflate within its declared size and match its CRC.
 */
export function readZip(archive: Buffer): Map<string, Buffer> {
  const refuse = (why: string) => new TransferRefused(`Pod archive refused: ${why}`);
  let end = -1;
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 0xffff); at--)
    if (archive.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  if (end < 0) throw refuse("not a zip archive");
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw refuse("zip64 archives are not supported");
  if (count > scriptPodMemberBounds.maxFileCount + scriptPodMemberBounds.maxDirectoryCount)
    throw refuse(`more than ${scriptPodMemberBounds.maxFileCount} entries`);
  const entries = new Map<string, Buffer>();
  const folded = new Set<string>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== 0x02014b50)
      throw refuse("corrupt central directory");
    const flags = archive.readUInt16LE(at + 8);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const packed = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const skip = nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    const mode = archive.readUInt32LE(at + 38) >>> 16;
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + skip;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw refuse(`'${name}' is encrypted`);
    if ((mode & 0xf000) === 0xa000) throw refuse(`'${name}' is a link`);
    let path: string;
    try {
      path = packageMemberPathSchema.parse(name);
    } catch (error) {
      throw refuse(message(error));
    }
    if (!isPackageMember(path)) throw refuse(`pod archives never carry '${path}'`);
    if (folded.has(path.toLowerCase())) throw refuse(`duplicate or case-colliding entry '${path}'`);
    folded.add(path.toLowerCase());
    if (entries.size >= scriptPodMemberBounds.maxFileCount)
      throw refuse(`more than ${scriptPodMemberBounds.maxFileCount} files`);
    if (
      size > scriptPodMemberBounds.maxFileBytes ||
      (total += size) > scriptPodMemberBounds.maxTotalBytes
    )
      throw refuse(
        `over ${scriptPodMemberBounds.maxFileBytes} bytes per entry or ${scriptPodMemberBounds.maxTotalBytes} bytes total`,
      );
    if (local + 30 > archive.length || archive.readUInt32LE(local) !== 0x04034b50)
      throw refuse(`corrupt local header for '${path}'`);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + packed);
    if (data.length !== packed) throw refuse(`truncated entry '${path}'`);
    let bytes: Buffer;
    try {
      bytes =
        method === 0
          ? Buffer.from(data)
          : method === 8
            ? inflateRawSync(data, { maxOutputLength: size + 1 })
            : (() => {
                throw Error(`compression method ${method}`);
              })();
    } catch (error) {
      throw refuse(`'${path}' does not inflate within its declared size (${message(error)})`);
    }
    if (bytes.length !== size || crc32(bytes) !== crc)
      throw refuse(`'${path}' fails its size or CRC check`);
    entries.set(path, bytes);
  }
  return entries;
}

/**
 * Portable project: a project with machine `<Reference>` hint paths is regenerated without them
 * (framework, packages and usings kept); one without any already travels and keeps its bytes.
 * Execution derives its own project from this seed, so an omitted framework is year-neutral.
 */
function portableProject(project: Buffer): Buffer {
  const xml = project.toString("utf8").replace(/^﻿/, "");
  if (!/<Reference[\s/>]/.test(xml)) return project;
  const framework =
    /<TargetFramework>\s*([^<]+?)\s*<\/TargetFramework>/.exec(xml)?.[1] ??
    /<TargetFrameworks>\s*([^<;]+)/.exec(xml)?.[1]?.trim();
  const packages = new Map<string, string | undefined>();
  for (const match of xml.matchAll(
    /<PackageReference\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageReference>)/g,
  )) {
    const include = attribute(match[1]!, "Include");
    if (!include || [...packages.keys()].some((k) => k.toLowerCase() === include.toLowerCase()))
      continue;
    packages.set(
      include,
      attribute(match[1]!, "Version") ??
        /<Version>\s*([^<]+?)\s*<\/Version>/.exec(match[2] ?? "")?.[1],
    );
  }
  const usings = [
    ...new Set([
      ...DEFAULT_USINGS,
      ...[...xml.matchAll(/<Using\b([^>]*)\/?>/g)].flatMap(
        (m) => attribute(m[1]!, "Include") ?? [],
      ),
    ]),
  ].sort(ordinal);
  const lines = [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "  <PropertyGroup>",
    ...(framework ? [`    <TargetFramework>${escapeXml(framework)}</TargetFramework>`] : []),
    "    <LangVersion>latest</LangVersion>",
    "    <PlatformTarget>x64</PlatformTarget>",
    "    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>",
    "    <OutputType>Library</OutputType>",
    "    <ProduceReferenceAssembly>false</ProduceReferenceAssembly>",
    "    <ImplicitUsings>enable</ImplicitUsings>",
    "    <Nullable>disable</Nullable>",
    "  </PropertyGroup>",
    "",
    "  <ItemGroup>",
    '    <Compile Include="src/**/*.cs" />',
    "  </ItemGroup>",
    "",
    "  <ItemGroup>",
    ...[...packages]
      .sort(([a], [b]) => ordinal(a.toUpperCase(), b.toUpperCase()))
      .map(([include, version]) =>
        version
          ? `    <PackageReference Include="${escapeXml(include)}" Version="${escapeXml(version)}" />`
          : `    <PackageReference Include="${escapeXml(include)}" />`,
      ),
    "  </ItemGroup>",
    "",
    "  <ItemGroup>",
    ...usings.map((u) => `    <Using Include="${escapeXml(u)}" />`),
    "  </ItemGroup>",
    "</Project>",
    "",
  ];
  return Buffer.from(lines.join("\r\n"));
}

// Authority: dotnet/Pe.Revit.Scripting/Bootstrap/ScriptFileTemplates.cs DefaultUsings.
const DEFAULT_USINGS = [
  "System",
  "System.Collections.Generic",
  "System.Diagnostics",
  "System.IO",
  "System.Linq",
  "System.Text",
  "System.Text.RegularExpressions",
  "Autodesk.Revit.DB",
  "Autodesk.Revit.DB.Architecture",
  "Autodesk.Revit.DB.Electrical",
  "Autodesk.Revit.DB.Mechanical",
  "Autodesk.Revit.DB.Plumbing",
  "Autodesk.Revit.DB.Structure",
  "Autodesk.Revit.UI",
  "Pe.Revit.Scripting",
  "Pe.Revit.Scripting.Context",
  "Pe.Shared.RevitData",
  "Pe.Shared.RevitData.Schedules",
];

const attribute = (attributes: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attributes)?.[1]?.trim() || undefined;
const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byPath = ([a]: [string, unknown], [b]: [string, unknown]) => ordinal(a, b);

function unique(listing: PackageListing, id: string): AdmittedPackage {
  const found = listing.packages.filter((p) => p.id === id);
  if (found.length === 1) return found[0]!;
  throw found.length
    ? new TransferRefused(
        `Pod id '${id}' is claimed by folders ${found.map((p) => p.folder).join(", ")}.`,
        409,
      )
    : new TransferRefused(`No installed pod has id '${id}'.`, 404);
}

function bounded(files: { path: string; bytes: Buffer }[]) {
  const total = files.reduce((sum, f) => sum + f.bytes.length, 0);
  const large = files.find((f) => f.bytes.length > scriptPodMemberBounds.maxFileBytes);
  if (
    files.length > scriptPodMemberBounds.maxFileCount ||
    total > scriptPodMemberBounds.maxTotalBytes ||
    large
  )
    throw new TransferRefused(
      `Pod export exceeds ${scriptPodMemberBounds.maxFileCount} files, ${scriptPodMemberBounds.maxFileBytes} bytes per file${large ? ` ('${large.path}')` : ""}, or ${scriptPodMemberBounds.maxTotalBytes} bytes total.`,
    );
}

function zipPath(path: string): string {
  if (!isAbsolute(path) || !/\.zip$/i.test(path))
    throw new TransferRefused(`Pod archive path must be an absolute .zip path: ${path}`, 400);
  return path;
}

/** A local folder name under Pods/: one plain Windows-safe segment, never a dot-folder. */
function localFolder(folder: string): string {
  if (
    !folder ||
    folder !== folder.trim() ||
    folder.startsWith(".") ||
    /[<>:"/\\|?*\x00-\x1f]/.test(folder) ||
    /[. ]$/.test(folder)
  )
    throw new TransferRefused(`Invalid local Pod folder '${folder}'.`, 400);
  return folder;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
