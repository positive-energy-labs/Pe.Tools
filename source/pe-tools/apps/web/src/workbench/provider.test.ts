import { describe, expect, test, vi } from "vite-plus/test";

import { deleteSessionThread, forkSessionThread, resumeDataForSuspension } from "./provider";

describe("native thread verbs", () => {
  test("fork clones the current thread before navigating to the clone", async () => {
    const events: string[] = [];
    await forkSessionThread(
      {
        cloneThread: async ({ sourceThreadId } = {}) => {
          events.push(`clone:${sourceThreadId}`);
          return { id: "thread-clone" };
        },
      },
      "thread-current",
      async (threadId) => void events.push(`navigate:${threadId}`),
    );
    expect(events).toEqual(["clone:thread-current", "navigate:thread-clone"]);
  });

  test("deleting the current thread navigates first; deleting another stays direct", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    const events: string[] = [];
    const session = { deleteThread: async (id: string) => void events.push(`delete:${id}`) };
    const navigate = async (id: string) => void events.push(`navigate:${id}`);

    await deleteSessionThread(session, "thread-current", "thread-current", navigate);
    expect(events).toEqual([
      "navigate:00000000-0000-4000-8000-000000000001",
      "delete:thread-current",
    ]);

    events.length = 0;
    await deleteSessionThread(session, "thread-current", "thread-other", navigate);
    expect(events).toEqual(["delete:thread-other"]);
  });
});

describe("native suspension resume payloads", () => {
  test("preserves request-access and ask-user answer shapes", () => {
    expect(resumeDataForSuspension("request_access", {}, false)).toBe("Yes");
    expect(resumeDataForSuspension("request_access", {}, true)).toBe("No");
    expect(
      resumeDataForSuspension("ask_user", { options: ["A", "B"], selectionMode: "single" }, false),
    ).toBe("A");
    expect(
      resumeDataForSuspension(
        "ask_user",
        { options: [{ label: "A" }, { label: "B" }], selectionMode: "multiple" },
        false,
      ),
    ).toEqual(["A"]);
    expect(resumeDataForSuspension("ask_user", {}, true)).toBe("(skipped)");
  });

  test("preserves the plan resume record", () => {
    expect(
      resumeDataForSuspension(
        "submit_plan",
        { path: "plan.md", title: "Plan", plan: "Do it" },
        false,
      ),
    ).toEqual({ action: "approved", path: "plan.md", title: "Plan", plan: "Do it" });
    expect(resumeDataForSuspension("submit_plan", { path: "plan.md" }, true)).toEqual({
      action: "rejected",
      feedback: "Rejected from workbench.",
      path: "plan.md",
    });
  });
});
