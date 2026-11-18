/**
 * The two guards (ADR 0038, homes MAP slices 3 and 8). The host doors' own tests are in
 * `instances-actions.test.ts`; Pea's `read_document` is in `packages/mcps/tests/read-document.test.ts`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { GUARDED_ACTS, type Caller } from "@pe/agent-contracts";
import { CommandRejected } from "../src/command-executor.ts";
import { guardDiscard, guardSave, guards } from "../src/guards.ts";
import { human, pea } from "./callers.ts";

const project = { title: "Office", isFamily: false, isModified: true };
/** The act a guard holds, or null when it lets the call through. */
const heldAct = (run: () => void) => {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof CommandRejected) || error.refusal.kind !== "held") throw error;
    expect(error.refusal.message).toMatch(/^Held, not done/);
    expect(error.refusal.message).not.toMatch(/refus|reject|declin|denied/i);
    return error.refusal.act;
  }
};

// R2: the acts that hold are these two and no others. A third guarded act is a new ADR, and
// this list is where it would have to be written first.
test("R2: exactly two acts hold, and every guard answers with one of them", () => {
  expect([...GUARDED_ACTS]).toEqual(["synchronize", "overwrite-or-discard"]);
  const acts = [
    heldAct(() => guardSave(pea(), "central", project)),
    heldAct(() => guardSave(pea(), "self", project)),
    heldAct(() => guardDiscard(pea(), [project], "close")),
  ];
  expect(acts).toEqual(["synchronize", "overwrite-or-discard", "overwrite-or-discard"]);
  // Census: every place the product words a held act names one of the two. The sentinel keeps
  // a moved file from passing on zero sites.
  const sources = ["apps/host/src", "packages/mcps/src/shared", "packages/agent-contracts/src"];
  const root = join(import.meta.dirname, "../../..");
  const named = sources.flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        [...readFileSync(join(root, dir, file), "utf8").matchAll(/\bh(?:e|o)ld\(\s*"([^"]+)"/g)].map(
          (match) => match[1]!,
        ),
      ),
  );
  expect(named).toHaveLength(3);
  expect([...new Set(named)].sort()).toEqual([...GUARDED_ACTS].sort());
});

test("only the person is not guarded: Pea, a Page, an MCP device, a service and no identity all hold", () => {
  const callers: Caller[] = [
    pea(),
    { kind: "anonymous" },
    { kind: "page", page: "page:@pages/p" },
    { kind: "external-mcp", device: "d", context: "c", label: "Device" },
    { kind: "service", service: "s" },
  ];
  for (const caller of callers) expect(guards(caller), caller.kind).toBe(true);
  expect(guards(human)).toBe(false);
  // The person's own act is never held, whatever the document.
  expect(heldAct(() => guardSave(human, "central", project))).toBeNull();
  expect(heldAct(() => guardDiscard(human, [project], "stop"))).toBeNull();
  // Not held for Pea: a Save As, a family document, a saved project document.
  expect(heldAct(() => guardSave(pea(), "save-as", project))).toBeNull();
  expect(heldAct(() => guardSave(pea(), "self", { ...project, isFamily: true }))).toBeNull();
  expect(heldAct(() => guardDiscard(pea(), [{ ...project, isFamily: true }], "close"))).toBeNull();
  expect(heldAct(() => guardDiscard(pea(), [{ ...project, isModified: false }], "close"))).toBeNull();
  // Held when the fact cannot be read: no `isModified`, or a document the census does not name.
  expect(heldAct(() => guardDiscard(pea(), [{ title: "Office" }], "close"))).toBe("overwrite-or-discard");
  expect(heldAct(() => guardDiscard(pea(), [{}], "stop"))).toBe("overwrite-or-discard");
  expect(heldAct(() => guardSave(pea(), "self", undefined))).toBe("overwrite-or-discard");
});
