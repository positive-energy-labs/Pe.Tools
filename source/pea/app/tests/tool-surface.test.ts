import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { peaProductTools } from "../tools/pea/tools.js";
import { repoDevTools } from "../tools/index.js";

describe("Pea tool surface", () => {
  it("does not expose protocol delegation internals as duplicate harness tools", () => {
    const peaToolIds = Object.keys(peaProductTools).sort();
    const devToolIds = Object.keys(repoDevTools).sort();
    const toolIds = [...peaToolIds, ...devToolIds];

    assert.deepEqual(
      toolIds.filter((id) => id.startsWith("runtime_client_")),
      [],
    );
    assert.deepEqual(
      toolIds.filter((id) =>
        /^client_(fs|file|terminal|shell)|^(fs|file|terminal|shell)_/.test(id),
      ),
      [],
    );
    assert.deepEqual(peaToolIds, [
      "host_operation_call",
      "host_operation_search",
      "pe_logs",
      "pe_status",
      "request_access",
      "revit_api_docs_fetch",
      "revit_api_docs_search",
      "script_bootstrap",
      "script_execute",
      "script_pod_export",
      "script_pod_import",
    ]);
    assert.deepEqual(devToolIds, [
      "live_loop_context",
      "live_rrd_restart",
      "live_rrd_sync",
      "script_execute",
      "talk_to_pea",
      "test",
    ]);
  });
});
