import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "@pe/host-internal/native-read";

const directory = join(import.meta.dirname, "native-recordings");
const provenance = JSON.parse(readFileSync(join(directory, "provenance.json"), "utf8")) as Record<string, { operation: string; source: string; canonicalResponseSha256: string; requestFile?: string }>;

export function nativeRecordings(...names: string[]) {
  const responses: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  for (const name of names) {
    const record = provenance[name];
    if (!record) throw Error(`UNPROVEN[no recording]: ${name}`);
    const value = JSON.parse(readFileSync(join(directory, `${name}.json`), "utf8"));
    // Git controls wire-file line endings; integrity belongs to the decoded JSON value.
    if (createHash("sha256").update(canonicalJson(value)).digest("hex") !== record.canonicalResponseSha256)
      throw Error(`Recorded native body changed: ${name}`);
    responses[record.operation] = value;
    sources[record.operation] = record.source;
  }
  return { responses, sources };
}

export function nativeRecordingRequest(name: string): Record<string, any> {
  const file = provenance[name]?.requestFile;
  if (!file) throw Error(`UNPROVEN[no recorded request]: ${name}`);
  return JSON.parse(readFileSync(join(directory, file), "utf8"));
}
