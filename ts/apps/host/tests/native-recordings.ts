import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const directory = join(import.meta.dirname, "native-recordings");
const provenance = JSON.parse(readFileSync(join(directory, "provenance.json"), "utf8")) as Record<string, { operation: string; source: string; responseSha256: string; requestFile?: string }>;

export function nativeRecordings(...names: string[]) {
  const responses: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  for (const name of names) {
    const record = provenance[name];
    if (!record) throw Error(`UNPROVEN[no recording]: ${name}`);
    const bytes = readFileSync(join(directory, `${name}.json`));
    if (createHash("sha256").update(bytes).digest("hex") !== record.responseSha256)
      throw Error(`Recorded native body changed: ${name}`);
    responses[record.operation] = JSON.parse(bytes.toString("utf8"));
    sources[record.operation] = record.source;
  }
  return { responses, sources };
}

export function nativeRecordingRequest(name: string): Record<string, any> {
  const file = provenance[name]?.requestFile;
  if (!file) throw Error(`UNPROVEN[no recorded request]: ${name}`);
  return JSON.parse(readFileSync(join(directory, file), "utf8"));
}
