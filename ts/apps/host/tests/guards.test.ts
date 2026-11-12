/**
 * The three guards (ADR 0038, homes MAP slices 3 and 8). The host doors' own tests are in
 * `instances-actions.test.ts`; Pea's `read_document` is in `packages/mcps/tests/read-document.test.ts`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { GUARDED_ACTS, heldSendSchema, type Caller, type HeldSendRequest } from "@pe/agent-contracts";
import { z } from "zod";
import { CommandRejected } from "../src/command-executor.ts";
import { guardDiscard, guardSave, guardSend, guards, heldSends } from "../src/guards.ts";
import { noticeRows } from "../src/notice-feed.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { testJournal } from "./effect-test.ts";
import { outwardSendExecutor } from "../src/outward-send.ts";
import { actAs, human, pea } from "./callers.ts";

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

// R2: the acts that hold are these three and no others. A fourth guarded act is a new ADR, and
// this list is where it would have to be written first.
test("R2: exactly three acts hold, and every guard answers with one of them", () => {
  expect([...GUARDED_ACTS]).toEqual(["synchronize", "overwrite-or-discard", "send-outward"]);
  const acts = [
    heldAct(() => guardSave(pea(), "central", project)),
    heldAct(() => guardSave(pea(), "self", project)),
    heldAct(() => guardDiscard(pea(), [project], "close")),
    heldAct(() => guardSend(pea(), { service: "llamaparse", path: "spec.pdf" }, "LlamaCloud")),
  ];
  expect(acts).toEqual(["synchronize", "overwrite-or-discard", "overwrite-or-discard", "send-outward"]);
  // Census: every place the product words a held act names one of the three. The sentinel keeps
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
  expect(named.length).toBeGreaterThanOrEqual(5);
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
  expect(heldAct(() => guardSend(human, { service: "llamaparse", path: "spec.pdf" }, "LlamaCloud"))).toBeNull();
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

// Guard 3 at the host's door (R3). Mutant that turns this red: in `src/pe-routes.ts` delete the
// `requireHuman` line of `outward.confirm` (Pea's own confirm then sends).
test("guard 3: Pea's send is held at once with one notice row; only the person's Confirm sends it", async () => {
  const sent: HeldSendRequest[] = [];
  const sendHeld = vi.fn(async (send: HeldSendRequest) => void sent.push(send));
  const journal = testJournal();
  journal.bindCommands({ resolve: () => outwardSendExecutor(sendHeld), probe: async () => null });
  const routes = createPeRoutes({
    registrations: [],
    heads: { observe: () => () => {} },
    store: { getState: async () => null, setState: async () => {} },
    journal,
  });
  const post = (caller: Caller, path: string, body?: unknown) =>
    actAs(caller, () =>
      routes.fetch(
        new Request(`http://host${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      ),
    );
  const request = { service: "llamaparse", path: "C:/specs/spec.pdf", sha256: "a".repeat(64), pages: "1-3" };
  const before = heldSends().length;

  const hold = await post(pea("sender"), "/pe/outward/held", request);
  expect(hold.status).toBe(200);
  const { held, message } = z.object({ held: heldSendSchema, message: z.string() }).parse(await hold.json());
  expect(message).toMatch(/^Held, not done/);
  expect(message).not.toMatch(/refus|reject|declin|denied/i);
  expect(held).toMatchObject({ ...request, thread: "sender" });
  expect(sendHeld).not.toHaveBeenCalled();
  // The same bytes and pages asked twice are one held send, so one notice row.
  expect(z.object({ held: heldSendSchema }).parse(await (await post(pea("sender"), "/pe/outward/held", request)).json()).held.id).toBe(held.id);
  expect(heldSends()).toHaveLength(before + 1);
  const rows = noticeRows(
    { threads: [], receipts: [], works: [], machine: null, stored: [], held: heldSends() },
    Date.now(),
  ).filter((row) => row.key === `held:${held.id}`);
  expect(rows).toMatchObject([
    { group: "waits", verb: "held", act: { kind: "confirm-send", id: held.id, to: "LlamaCloud", detail: `pages ${held.pages}` } },
  ]);

  // Pea cannot confirm its own send.
  await expect(post(pea("sender"), `/pe/outward/held/${held.id}/confirm`)).rejects.toThrow(/human.only/);
  expect(sendHeld).not.toHaveBeenCalled();
  expect(heldSends()).toHaveLength(before + 1);

  // The person's Confirm sends exactly the held request, once, and the row leaves.
  const confirmations = await Promise.all([
    post(human, `/pe/outward/held/${held.id}/confirm`),
    post(human, `/pe/outward/held/${held.id}/confirm`),
  ]);
  expect(confirmations.map(response => response.status)).toEqual([202, 404]);
  const accepted = await confirmations[0]!.json() as { id: string };
  const settled = await journal.wait(accepted.id);
  expect(settled.state, JSON.stringify(settled)).toBe("succeeded");
  const { id: _id, at: _at, thread: _thread, ...requestSent } = held;
  expect(sent).toEqual([requestSent]);
  expect(heldSends()).toHaveLength(before);
  expect((await post(human, `/pe/outward/held/${held.id}/confirm`)).status).toBe(404);
  expect(sendHeld).toHaveBeenCalledTimes(1);

  // The proof a sending server asks for (the doc lab's parse route): only the person is answered ok.
  await expect(post(pea("sender"), "/pe/outward/person")).rejects.toThrow(/human.only/);
  await expect(post({ kind: "anonymous" }, "/pe/outward/person")).rejects.toThrow(/context.missing/);
  expect((await post(human, "/pe/outward/person")).status).toBe(200);
});
