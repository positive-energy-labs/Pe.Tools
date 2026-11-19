import { ductSystemsTool } from "@pe/duct-systems-contract/semantic-actions";
import { sheetCommands } from "@pe/ducts-contract/semantic-actions";
import { fansTool } from "@pe/fans-contract/semantic-actions";
import {
  builtinCommandHead,
  targetForCommand,
  tools as sharedTools,
  withHostActions,
} from "@pe/agent-contracts/semantic-actions";
import type { DocumentRef, Tool } from "@pe/agent-contracts";

const { findings, instances, ...routeTools } = sharedTools;
type ProductTools = typeof sharedTools & { fans: typeof fansTool; ducts: typeof ductSystemsTool };
export const tools: ProductTools = {
  ...routeTools,
  fans: fansTool,
  ducts: ductSystemsTool,
  findings,
  instances,
};
export const commands = {
  ...builtinCommandHead,
  ...sheetCommands,
  ...tools.pods.commands,
  ...tools.family.commands,
  ...tools.families.commands,
  ...tools.schedules.commands,
  ...tools.takeoffs.commands,
  ...tools.rooms.commands,
  ...ductSystemsTool.commands,
  ...findings.commands,
  ...instances.commands,
};
export const hostActions = withHostActions(commands);

export type SemanticActionKey = keyof typeof commands;
export type HostActionKey = keyof typeof hostActions;
export const commandTarget = (
  key: string,
  input: Record<string, unknown>,
  document?: DocumentRef,
) => targetForCommand(hostActions, key, input, document);

export function commandTool(key: string): Tool | undefined {
  return Object.values(tools).find((tool) => Object.hasOwn(tool.commands, key));
}
