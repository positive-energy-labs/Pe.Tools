import { createPeClient } from "@pe/agent-contracts/pe-api";
import { hostFetch } from "@pe/web-kernel/host/runtime";

export const peClient = createPeClient("", hostFetch);
