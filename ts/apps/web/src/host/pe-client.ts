import { createPeClient } from "@pe/agent-contracts/pe-api";
import { hostFetch } from "./runtime";

export const peClient = createPeClient("", hostFetch);
