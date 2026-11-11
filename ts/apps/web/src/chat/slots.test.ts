/**
 * Slice 10 for /pea (routes MAP row 10, the slot plan in the routes ledger): the thread is the
 * subject (keyKind `workspace`) and `title(ctx)` names it in the chat pane head.
 *
 * kernel gap: chat-thread-subject. The subject slot binds a Page field (`spec.fields[subject.field]`
 * in `route()` and `shell/typed-mount.ts`), and the thread lives in the root carry key `thread`,
 * which no route may declare (`carryKeys`, `packages/agent-contracts/src/route-address.ts:65`):
 * every route's docked Pea reads it, and its value is a plain thread id, not a subject set. A
 * `title(ctx)` cannot name the thread either, because a draw context carries no carry key. Closing
 * this is a kernel ruling (a carry-keyed subject, or the carry becoming chat's subject field with
 * every `?thread=` link rewritten), not a route edit; until then the chat pane keeps its own head.
 */
import { expect, test } from "vite-plus/test";
import { module } from "./route.ts";

test.fails("kernel gap: chat-thread-subject (2): the thread is /pea's subject, and its name rides the chat pane head", () => {
  expect(module.spec.subject).toMatchObject({ noun: "thread", pane: "threads" });
  expect(module.spec.title).toBeTypeOf("function");
});

test("/pea declares no sheet, picture or goal", () => {
  expect([module.spec.sheet, module.spec.picture, module.spec.goal]).toEqual([undefined, undefined, undefined]);
});
