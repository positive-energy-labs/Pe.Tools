import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { noteStored, writeAtomic } from "@pe/host-contracts/store";
import { peaAgentInstructions } from "@pe/mcps";
import { productAgentPath } from "./product-paths.ts";
import { hostOwnership } from "./host-ownership.ts";
import { storedNoticesPath } from "./notice-feed.ts";

/** Refuse checkout inheritance before composing a host that can spawn a harness child. */
export function prepareAgentDirectory(): void {
  const agent = productAgentPath();
  // The dev default lives under .artifacts in the checkout by design; fence only dev overrides.
  if (hostOwnership.lane === "dev" && process.env[productPathNames.productHomeVariable]?.trim()) {
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
  }
  const instructions = join(agent, productPathNames.agentInstructionsFileName);
  try {
    mkdirSync(agent, { recursive: true });
    // ADR 0037 rule 6: product-owned machine state outside every home is replaced on any
    // byte difference; a hand edit to state/Agent/AGENTS.md is not kept.
    if (!existsSync(instructions) || readFileSync(instructions, "utf8") !== peaAgentInstructions)
      writeAtomic(instructions, peaAgentInstructions);
  } catch (error) {
    console.error("Agent instructions unavailable", { path: instructions, error });
    noteStored(storedNoticesPath(), {
      class: "keep", place: "Agent instructions", path: instructions,
      sha256: null, reason: `Instructions unavailable: ${String(error)}`,
    });
  }
}
