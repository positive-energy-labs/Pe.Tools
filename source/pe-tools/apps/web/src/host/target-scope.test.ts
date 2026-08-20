import { describe, expect, it } from "vite-plus/test";

import type { SessionFacts } from "./target";
import {
  CHAT_CONSUMER,
  clearScoped,
  isInherited,
  readScoped,
  resolveScoped,
  writeScoped,
  type TargetBook,
  type TargetScope,
} from "./target-scope";

const chat = (threadId: string): TargetScope => ({ threadId, consumerId: CHAT_CONSUMER });
const plugin = (threadId: string, id: string): TargetScope => ({ threadId, consumerId: id });

const observed: SessionFacts = {
  sessionId: "aaa111",
  processId: 4128,
  lane: "installed",
  custody: "observed",
  activeDocumentTitle: "Tower-A.rvt",
  openDocumentCount: 1,
};
const controlled: SessionFacts = {
  sessionId: "bbb222",
  processId: 9204,
  lane: "installed",
  custody: "controlled",
  sdkSessionId: "fam-lab",
  openDocumentCount: 1,
};

describe("target-scope", () => {
  it("a plugin with no pin inherits the thread's chat pin; its own pin overrides", () => {
    const book = writeScoped({}, chat("t1"), "observed");
    expect(readScoped(book, plugin("t1", "inspector"))).toBe("observed"); // inherited
    const overridden = writeScoped(book, plugin("t1", "inspector"), "session:fam-lab");
    expect(readScoped(overridden, plugin("t1", "inspector"))).toBe("session:fam-lab"); // own pin wins
    expect(readScoped(overridden, chat("t1"))).toBe("observed"); // chat untouched
  });

  it("scopes are isolated per thread — switching threads switches context wholesale", () => {
    const book = writeScoped(
      writeScoped({}, chat("t1"), "observed"),
      chat("t2"),
      "session:fam-lab",
    );
    expect(readScoped(book, chat("t1"))).toBe("observed");
    expect(readScoped(book, chat("t2"))).toBe("session:fam-lab");
    expect(readScoped(book, chat("t3"))).toBe(""); // untouched thread is auto, not bled-into
  });

  it('"" is a real pin (auto), distinct from an absent entry (inherit)', () => {
    const pinnedAuto = writeScoped({}, plugin("t1", "inspector"), "");
    expect(isInherited(pinnedAuto, plugin("t1", "inspector"))).toBe(false); // owns "", not inheriting
    expect(isInherited({}, plugin("t1", "inspector"))).toBe(true); // absent → inherits
    // even with a chat pin present, an explicit "" ignores it
    const withChat = writeScoped(pinnedAuto, chat("t1"), "observed");
    expect(readScoped(withChat, plugin("t1", "inspector"))).toBe("");
  });

  it("clearScoped drops a plugin's own pin back to inheriting the chat", () => {
    const book = writeScoped(writeScoped({}, chat("t1"), "observed"), plugin("t1", "insp"), "9204");
    expect(readScoped(book, plugin("t1", "insp"))).toBe("9204");
    const cleared = clearScoped(book, plugin("t1", "insp"));
    expect(readScoped(cleared, plugin("t1", "insp"))).toBe("observed"); // back to inherited
  });

  it("writes are pure — the input book is never mutated (single-writer, no shared fork)", () => {
    const book: TargetBook = {};
    const next = writeScoped(book, chat("t1"), "observed");
    expect(book).toEqual({}); // original untouched
    expect(next).not.toBe(book);
  });

  it("resolveScoped composes with the live resolver — inherited pin resolves, dangling still dangles", () => {
    const book = writeScoped({}, chat("t1"), "observed");
    // inherited pin resolves against the live world
    expect(resolveScoped(book, plugin("t1", "insp"), [observed])).toMatchObject({
      kind: "resolved",
      session: { sessionId: "aaa111" },
    });
    // the pinned process is gone → dangling, not a silent wrong target
    expect(resolveScoped(book, chat("t1"), [controlled])).toMatchObject({
      kind: "unresolved",
      reason: "no-match",
    });
  });
});
