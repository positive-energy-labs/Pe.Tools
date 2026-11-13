/** Worker files are a disk boundary: decode strings, then mint their state scope again. */
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { stateTree } from "@pe/host-contracts/service-identity";
import type { KeeperConfig } from "./browser.ts";

const directorySchema = z
  .object({
    path: z.string(),
    machine: z.object({
      state: z.string(),
      notices: z.string(),
      blobs: z.string(),
      derived: z.string(),
    }),
  })
  .transform((input, context) => {
    const machine = stateTree(dirname(input.machine.state));
    const under = relative(machine.state, input.path);
    if (
      !isAbsolute(input.path) ||
      !isAbsolute(input.machine.state) ||
      under === ".." ||
      under.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(under) ||
      machine.state !== input.machine.state ||
      machine.notices !== input.machine.notices ||
      machine.blobs !== input.machine.blobs ||
      machine.derived !== input.machine.derived
    ) {
      context.addIssue({
        code: "custom",
        message: "Worker storage is not a scope of its machine state",
      });
      return z.NEVER;
    }
    return machine.directory(...under.split(/[\\/]/).filter(Boolean));
  });
const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const keeperConfigSchema = z.object({
  id: z.uuid(),
  token: z.string().min(1),
  home: directorySchema,
  lifetime: z.enum(["caller", "session"]),
  open: z
    .object({
      mode: z.enum(["headless", "visible"]).optional(),
      viewport: viewportSchema.optional(),
      executablePath: z.string().optional(),
      profile: z.string().optional(),
      home: z.string().optional(),
      args: z.array(z.string()).optional(),
      timeoutMs: z.number().positive().optional(),
      lifetime: z.enum(["caller", "session"]).optional(),
    })
    .optional(),
  attach: z
    .object({
      endpoint: z.union([z.string(), z.number()]).optional(),
      autoConnect: z.boolean().optional(),
      profile: z.string().optional(),
      home: z.string().optional(),
      timeoutMs: z.number().positive().optional(),
      clientId: z.string().optional(),
    })
    .optional(),
});
export const decodeKeeperConfig = (value: unknown): KeeperConfig => keeperConfigSchema.parse(value);
export const guardianConfigSchema = z
  .object({
    storage: directorySchema,
    endpoint: z.string().min(1),
    receipt: z.string(),
    lock: z.object({ path: z.string(), marker: z.string() }),
    timeoutMs: z.number().positive(),
  })
  .refine(
    (config) => resolve(config.receipt) === join(config.storage.path, "session.json"),
    "Guardian receipt does not belong to its storage scope",
  );
export const decodeGuardianConfig = (value: unknown) => guardianConfigSchema.parse(value);
