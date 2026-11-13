import { contract } from "@pe/agent-contracts/handle";
import { args, value, key } from "./schema.ts";

export const calculation = contract(`${key}.calculation`, { input: args, data: value, uses: [], subject: "None" });
