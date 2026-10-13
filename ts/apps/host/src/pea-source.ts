import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants, copyFile, mkdir, rename } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";

/**
 * What Pea opens when a launch is hers (ADR 0016: her sessions, copies and files are always
 * writable, so a user's own file is never her scratch).
 * - a local file that is not workshared is copied into Pea's work folder and the copy opens;
 * - a workshared model or a cloud identity opens detached (the SDK's own `--detach`).
 */
export interface PeaSource {
  /** The path `doc open` receives: the copy, or the source untouched. */
  readonly opened: string;
  /** The user's file the copy was made from; null when nothing was copied. */
  readonly copiedFrom: string | null;
  readonly detach: boolean;
}

// BasicFileInfo, the stream every .rvt carries, is UTF-16 text; its Worksharing line reads
// "Worksharing: Not enabled" for a model that was never workshared.
const WORKSHARING = Buffer.from("Worksharing: ", "utf16le");
const NOT_ENABLED = Buffer.from("Not enabled", "utf16le");

/**
 * Whether a Revit file is workshared, read from its BasicFileInfo text without opening Revit.
 * Null when the file carries no Worksharing line: the caller refuses rather than guess.
 */
async function readWorkshared(path: string): Promise<boolean | null> {
  const wanted = WORKSHARING.length + NOT_ENABLED.length;
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 4 << 20 })) {
    const buffer = Buffer.concat([carry, chunk as Buffer]);
    const at = buffer.indexOf(WORKSHARING);
    if (at >= 0) {
      if (buffer.length < at + wanted) {
        carry = buffer.subarray(at);
        continue;
      }
      return !buffer.subarray(at + WORKSHARING.length, at + wanted).equals(NOT_ENABLED);
    }
    carry = buffer.subarray(Math.max(0, buffer.length - wanted + 1));
  }
  // A file that ends inside the value: what is there decides.
  const at = carry.indexOf(WORKSHARING);
  if (at < 0 || at + WORKSHARING.length >= carry.length) return null;
  const value = carry.subarray(at + WORKSHARING.length);
  return !NOT_ENABLED.subarray(0, value.length).equals(value);
}

const isCloudIdentity = (source: string) => /^(cld:\/\/|cloud:)/i.test(source);

/**
 * Decide, and do, the copy for a launch that is Pea's. Nothing here touches the user's file: a
 * refusal leaves it exactly as it was.
 */
export async function peaSourceOf(
  launch: { source: string; template?: boolean; reload?: boolean; detach?: boolean },
  workRoot: string,
): Promise<PeaSource> {
  const detach = launch.detach ?? false;
  // A template creates a new document and a reload acts on an open one: neither is a user's file.
  if (launch.template || launch.reload) return { opened: launch.source, copiedFrom: null, detach };
  if (isCloudIdentity(launch.source))
    return { opened: launch.source, copiedFrom: null, detach: true };
  if (!isAbsolute(launch.source))
    throw new Error(
      `Pea opens a local path or a cloud identity; '${launch.source}' is neither. Read recents for the path it opens with.`,
    );
  const workshared =
    extname(launch.source).toLowerCase() === ".rvt" ? await readWorkshared(launch.source) : false;
  if (workshared === null)
    throw new Error(
      `Could not read the worksharing state of ${launch.source}; open it with the person's own session instead.`,
    );
  if (workshared) return { opened: launch.source, copiedFrom: null, detach: true };
  const dir = join(workRoot, randomUUID());
  await mkdir(dir, { recursive: true });
  const copy = join(dir, basename(launch.source));
  // Written under a temporary name so a half-written copy never has the name an open would take.
  await copyFile(launch.source, `${copy}.part`, constants.COPYFILE_EXCL);
  await rename(`${copy}.part`, copy);
  return { opened: copy, copiedFrom: launch.source, detach };
}
