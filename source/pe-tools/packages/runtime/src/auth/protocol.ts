import type { AuthMethod } from "@agentclientprotocol/sdk";
import type { AgentCapabilities } from "@ag-ui/core";
import type { RuntimeAuthDescriptor } from "./types.ts";

export function toAcpAuthMethods(descriptor: RuntimeAuthDescriptor): AuthMethod[] {
  return descriptor.methods.map((method) => {
    if (method.kind === "env_var") {
      return {
        type: "env_var",
        id: method.id,
        name: method.name,
        description: method.description,
        vars: [
          {
            name: method.envName,
            label: method.name,
            secret: true,
            optional: method.optional,
          },
        ],
      };
    }

    return {
      id: method.id,
      name: method.name,
      description: method.description,
    };
  });
}

export function toAgUiAuthCapabilities(
  descriptor: RuntimeAuthDescriptor,
): NonNullable<AgentCapabilities["custom"]> {
  return {
    "runtime.authSource": descriptor.source,
    "runtime.logoutSupported": descriptor.logoutSupported,
    "runtime.authMethods": descriptor.methods.map((method) => ({
      id: method.id,
      kind: method.kind,
      name: method.name,
    })),
  };
}
