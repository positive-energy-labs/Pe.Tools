import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PeaAcpRuntimeClient } from "../acp/pea-acp-runtime-client.js";

describe("ACP runtime client bridge", () => {
  it("converts Pea runtime permission requests to ACP requestPermission calls", async () => {
    const requests: unknown[] = [];
    const client = new PeaAcpRuntimeClient({
      async requestPermission(request) {
        requests.push(request);
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      },
    });

    const response = await client.requestPermission({
      sessionId: "session-1",
      toolCall: {
        toolCallId: "tool-1",
        toolName: "write_file",
        title: "Write file",
        input: { path: "C:/repo/file.txt" },
      },
    });

    assert.deepEqual(response, { outcome: "selected", optionId: "allow_once" });
    assert.deepEqual(requests, [
      {
        sessionId: "session-1",
        toolCall: {
          toolCallId: "tool-1",
          title: "Write file",
          kind: "edit",
          status: "pending",
          rawInput: { path: "C:/repo/file.txt" },
        },
        options: [
          {
            optionId: "allow_once",
            name: "Allow once",
            kind: "allow_once",
          },
          {
            optionId: "reject_once",
            name: "Reject once",
            kind: "reject_once",
          },
        ],
      },
    ]);
  });

  it("returns cancelled when the ACP client has no permission request transport", async () => {
    const client = new PeaAcpRuntimeClient({});

    await client.configure(undefined);
    assert.deepEqual(
      await client.requestPermission({
        sessionId: "session-1",
        toolCall: {
          toolCallId: "tool-1",
          toolName: "execute_command",
        },
      }),
      { outcome: "cancelled" },
    );
  });
});
