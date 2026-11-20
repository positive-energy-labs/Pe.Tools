import { lossWrites } from "@pe/ducts-contract/product";
import { admissionPreflight } from "./admission.ts";
import { peaGuide } from "./pea/ducts-skill.ts";
import { fansReadDiscovery } from "./read-discovery.ts";
import { fansTool } from "./semantic-actions.ts";

export const product = {
  id: "fans",
  tools: { fans: fansTool },
  actions: fansTool.commands,
  reads: fansReadDiscovery,
  guide: peaGuide,
  admissionPreflight,
  sheet: { writes: lossWrites },
};
