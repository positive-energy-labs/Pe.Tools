import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Script } from "node:vm";
import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";

/** Validate without executing or reserializing authored bytes. Modules remain browser-checked. */
export function validatePageHtml(html: string, fragment = false) {
  const errors: string[] = [];
  const document = (fragment ? parseFragment : parse)(html, {
    onParseError: (error) => errors.push(error.code),
  });
  if (errors.length) throw Error(`Invalid HTML: ${errors.join(", ")}`);
  if (/\/\*pe:[^*]+\*\/\s*null\b/.test(html)) throw Error("Unfilled pe.js slot in Page HTML");
  const javascript = (source: string, what: string) => {
    try {
      new Script(source);
    } catch (error) {
      throw Error(`Invalid ${what} JavaScript: ${(error as Error).message}`);
    }
  };
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node) {
      const type = node.attrs.find((attribute) => attribute.name === "type")?.value ?? "";
      if (
        node.tagName === "script" &&
        !node.attrs.some((a) => a.name === "src") &&
        ["", "text/javascript", "application/javascript"].includes(type)
      )
        javascript(
          node.childNodes.map((child) => ("value" in child ? child.value : "")).join(""),
          "inline",
        );
      for (const attribute of node.attrs.filter((a) => a.name.startsWith("on")))
        javascript(`(function(event){${attribute.value}\n})`, "handler");
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(document);
}

export function artifactRelative(root: string, path: string) {
  const from = relative(resolve(root), resolve(path));
  if (from === ".." || from.startsWith("..\\") || from.startsWith("../") || isAbsolute(from))
    throw Error(`Artifact refuses a path outside its root: ${path}`);
  return from.replaceAll("\\", "/");
}

/** Publication cannot follow a redirected ancestor, including its configured Pages root. */
export async function ordinaryPath(path: string) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (info?.isSymbolicLink()) throw Error(`Page publication refuses a symlink: ${current}`);
    if (dirname(current) === current) return;
  }
}

/** Replace atomically or retain one immutable artifact; neither mode changes supplied bytes. */
export async function writeArtifact(
  root: string,
  path: string,
  source: string | Uint8Array,
  replace = false,
  rejectLinks = false,
) {
  const bytes = Buffer.from(source);
  root = resolve(root);
  path = resolve(path);
  const parts = artifactRelative(root, dirname(path)).split("/").filter(Boolean);
  if (rejectLinks) await ordinaryPath(path);
  await mkdir(root, { recursive: true });
  const actualRoot = await realpath(root);
  if (rejectLinks && actualRoot.toLowerCase() !== root.toLowerCase())
    throw Error("Page publication resolves outside its folder");
  root = actualRoot;
  let directory = root;
  for (const part of parts) {
    directory = join(directory, part);
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const actual = await realpath(directory);
    artifactRelative(root, actual);
    if (rejectLinks && actual.toLowerCase() !== directory.toLowerCase())
      throw Error("Page publication resolves outside its folder");
  }
  const temporary = join(directory, `.artifact-${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    if (replace) await rename(temporary, path);
    else
      await link(temporary, path).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        artifactRelative(root, await realpath(path));
        if (!(await readFile(path)).equals(bytes)) throw Error("Export artifact hash collision");
      });
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}
