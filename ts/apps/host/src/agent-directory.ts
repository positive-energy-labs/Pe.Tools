import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { writeAtomic } from "@pe/host-contracts/store";
import { peaAgentInstructions } from "@pe/mcps";
import { productAgentPath } from "./product-paths.ts";

/** Refuse checkout inheritance before composing a host that can spawn a harness child. */
export function prepareAgentDirectory(): void {
  const agent = productAgentPath();
  // Resolve the nearest existing ancestor too, so a junction cannot hide a checkout.
  let existing = agent;
  while (!existsSync(existing)) existing = dirname(existing);
  for (let ancestor = realpathSync(existing); ; ancestor = dirname(ancestor)) {
    if (existsSync(join(ancestor, ".git")))
      throw Error(
        `Agent directory ${agent} has a git checkout ancestor at ${ancestor}. ` +
          "The harness would inherit checkout instructions and MCP configuration. " +
          "Set PE_TOOLS_PRODUCT_HOME to a directory outside every git checkout.",
      );
    if (dirname(ancestor) === ancestor) break;
  }
  mkdirSync(agent, { recursive: true });
  const instructions = join(agent, productPathNames.agentInstructionsFileName);
  if (!existsSync(instructions) || readFileSync(instructions, "utf8") !== peaAgentInstructions)
    writeAtomic(instructions, peaAgentInstructions);
}
