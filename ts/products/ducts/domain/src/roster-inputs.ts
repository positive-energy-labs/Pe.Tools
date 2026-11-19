import type { DuctsInputs } from "@pe/ducts-contract/duct-inputs";
export const rosterInputs = (inputs: DuctsInputs) => ({
  kinds: Object.fromEntries(Object.entries(inputs.units).flatMap(([id, u]) => (u.kind.status === "valid" ? [[id, u.kind.value]] : []))),
  roles: Object.fromEntries(Object.entries(inputs.units).flatMap(([id, u]) => (u.role.status === "valid" ? [[id, u.role.value]] : []))),
});

