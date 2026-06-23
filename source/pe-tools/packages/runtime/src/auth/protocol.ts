import type { AuthMethod } from "@agentclientprotocol/sdk";
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
