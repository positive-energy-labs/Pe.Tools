import { nativeArgs } from "@pe/agent-contracts/native-output-read";
import {
  fingerprint,
  type InputPort,
  type InputRevision,
  type Value,
} from "@pe/host-internal/reads/evaluator";

type Completed = {
  definition: object;
  value: Value<unknown>;
  basis: readonly InputRevision[];
  nativeKeys: readonly string[];
  bytes: number;
};

/** An opt-in document mark covers native inputs to that exact opening. Other sources need proof. */
export class CompletedReads {
  private readonly entries = new Map<string, Completed>();
  private bytes = 0;

  get(key: string, definition: object) {
    const entry = this.entries.get(key);
    if (entry?.definition === definition) return entry;
  }

  keep(
    key: string,
    definition: object,
    value: Value<unknown>,
    basis: readonly InputRevision[],
    target: NonNullable<InputPort["reuse"]>["target"],
    bytes: number,
    limit: number,
  ) {
    if (
      value.coverage.refused.length ||
      value.coverage.unknown.length ||
      value.trace.some(({ outcome }) => outcome !== "answered")
    )
      return;
    let marked = false;
    const nativeKeys = new Set<string>();
    const opening = fingerprint(target);
    for (const { name, args } of basis) {
      if (name === "document-mark" && fingerprint(args) === opening) {
        marked = true;
        continue;
      }
      if (name !== "native") return;
      const native = nativeArgs.safeParse(args);
      if (
        !native.success ||
        native.data.version !== undefined ||
        native.data.target.kind !== "document" ||
        fingerprint(native.data.target.ref) !== opening
      )
        return;
      nativeKeys.add(native.data.key);
    }
    if (!marked) return;
    this.bytes -= this.entries.get(key)?.bytes ?? 0;
    this.entries.delete(key);
    this.entries.set(key, { definition, value, basis, nativeKeys: [...nativeKeys], bytes });
    this.bytes += bytes;
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= 32 && this.bytes <= limit) break;
      this.bytes -= entry.bytes;
      this.entries.delete(oldest);
    }
  }
}
