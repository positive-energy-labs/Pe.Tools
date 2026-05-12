import type { PeHostClientOptions } from "./host-client-runtime.js";
import { HostClient, ScriptingClient } from "./generated/host-client.generated.js";

export class PeHostClient {
  readonly host: HostClient;
  readonly scripting: ScriptingClient;

  constructor(private readonly options: PeHostClientOptions) {
    this.host = new HostClient(options);
    this.scripting = new ScriptingClient(options);
  }
}

export * from "./host-client-runtime.js";
export * from "./generated/host-client.generated.js";
export * from "./generated/host-types/index.js";
