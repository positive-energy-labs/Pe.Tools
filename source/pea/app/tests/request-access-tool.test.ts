import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LocalFilesystem } from "@mastra/core/workspace";
import { RequestContext } from "@mastra/core/request-context";
import { requestAccess, requestAccessRequiresApproval } from "../tools/shared/request-access.js";

function createToolContext(options: { workspaceRoot: string }) {
  const filesystem = new LocalFilesystem({ basePath: options.workspaceRoot, contained: true });
  const state: Record<string, unknown> = { sandboxAllowedPaths: [] };
  const harness = {
    getState: () => state,
    setState(next: Record<string, unknown>) {
      Object.assign(state, next);
    },
  };

  return {
    context: {
      workspace: { filesystem },
      requestContext: new RequestContext<unknown>([["harness", harness]]),
    },
    filesystem,
    state,
  };
}

describe("Pea request_access tool", () => {
  it("requires normal tool approval for paths outside the active LocalFilesystem workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "pea-workspace-"));
    const externalRoot = await mkdtemp(path.join(tmpdir(), "pea-external-"));
    const { context } = createToolContext({ workspaceRoot });

    assert.equal(
      requestAccessRequiresApproval(
        { path: externalRoot, reason: "inspect user-requested source file" },
        context,
      ),
      true,
    );
  });

  it("skips approval when the path is already inside the workspace or allowed paths", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "pea-workspace-"));
    const externalRoot = await mkdtemp(path.join(tmpdir(), "pea-external-"));
    const { context, filesystem } = createToolContext({ workspaceRoot });
    filesystem.setAllowedPaths(() => [path.resolve(externalRoot)]);

    assert.equal(
      requestAccessRequiresApproval(
        { path: path.join(workspaceRoot, "src"), reason: "already in workspace" },
        context,
      ),
      false,
    );
    assert.equal(
      requestAccessRequiresApproval(
        { path: externalRoot, reason: "already approved" },
        context,
      ),
      false,
    );
  });

  it("grants an approved path to LocalFilesystem immediately when execution is resumed", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "pea-workspace-"));
    const externalRoot = await mkdtemp(path.join(tmpdir(), "pea-external-"));
    const { context, filesystem, state } = createToolContext({ workspaceRoot });

    const result = await requestAccess.execute?.(
      { path: externalRoot, reason: "inspect user-requested source file" },
      context as never,
    );

    assert.equal((result as { isError?: boolean }).isError, false);
    assert.match((result as { content?: string }).content ?? "", /Access granted/);
    assert.deepEqual(state.sandboxAllowedPaths, [path.resolve(externalRoot)]);
    assert.equal(filesystem.resolveAbsolutePath(path.join(externalRoot, "file.txt"))?.startsWith(path.resolve(externalRoot)), true);
  });
});
