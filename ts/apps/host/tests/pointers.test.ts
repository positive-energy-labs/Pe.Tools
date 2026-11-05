import { expect, test } from "vite-plus/test";
import { dismiss, point, pointerThread, readPointers } from "../src/pointers.ts";

const pea = { kind: "pea", thread: "thread-A" } as never;
const human = { kind: "human", via: "browser" } as never;

test("Pea points in its own thread; the person reads and dismisses it by naming that thread", () => {
  const listed = point(pointerThread(pea, "thread-B"), {
    route: "fans",
    place: { selected: '["e:7"]' },
    label: "FC-1 fan flow",
  });
  expect(listed.threadId).toBe("thread-A");
  const [pointer] = readPointers(pointerThread(human, "thread-A")).pointers;
  expect(pointer).toMatchObject({ route: "fans", label: "FC-1 fan flow" });
  expect(readPointers("thread-B").pointers).toEqual([]);
  expect(dismiss(pointerThread(human, "thread-A"), pointer!.id).pointers).toEqual([]);
  expect(() => pointerThread(human, undefined)).toThrow(/thread/);
  expect(() => pointerThread({ kind: "anonymous" } as never, "thread-A")).toThrow();
});
