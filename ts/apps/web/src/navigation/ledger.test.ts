import { expect, test, vi } from "vite-plus/test";

const call = vi.fn();
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));
const { resumeThread } = await import("./ledger");

test("Resume re-sends the turn the host restart cut off, attachments and mentions included", async () => {
  const attachments = [{ name: "a.txt", mimeType: "text/plain", text: "x" }];
  call.mockImplementation(async (id: string) =>
    id === "thread.get"
      ? {
          events: [
            { kind: "prompt", seq: 1, at: "t", turnId: "t1", text: "first" },
            { kind: "turn_end", seq: 2, at: "t", turnId: "t1" },
            { kind: "prompt", seq: 3, at: "t", turnId: "t2", text: "size the duct", attachments },
            {
              kind: "error",
              seq: 4,
              at: "t",
              turnId: "t2",
              message: "host restarted during this turn",
            },
          ],
        }
      : { turnId: "t3" },
  );
  await resumeThread("cut");
  expect(call).toHaveBeenLastCalledWith("thread.prompt", {
    params: { id: "cut" },
    body: { text: "size the duct", attachments, mentions: undefined },
  });
});
