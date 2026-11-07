import { settingsFieldPointer, type SettingsFieldState } from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { FAMILY_MODEL_SCHEMA } from "../family/page";
import type { AuthoredFamilyName } from "../family/authored-families";

export function familyDemoFields(raw: string): Record<string, SettingsFieldState> {
  const parameters = (JSON.parse(raw) as { parameters?: Record<string, { dataType?: string }> })
    .parameters;
  const [edit, proposed] = Object.entries(parameters ?? {})
    .filter(([, spec]) => spec.dataType === "Length")
    .map(([name]) => settingsFieldPointer(["parameters", name, "value"]));
  return {
    ...(edit ? { [edit]: { edit: { value: "5in" } } } : {}),
    ...(proposed
      ? {
          [proposed]: {
            edit: { value: "6in", note: "office standard", confidence: "low" },
          },
        }
      : {}),
  };
}

const DEMO_POD = "demo";
const demoPath = (name: AuthoredFamilyName) => `settings/family/${name}.json`;
const demoHash = (n: number) => String(n).repeat(64);
const FAMILY_NAMES = ["box", "grd", "bath", "refline"] as const satisfies AuthoredFamilyName[];

/** The demo pod: the four authored fixtures, each a family model member. */
export const FAMILY_DEMO_PODS: readonly PodList["pods"][number][] = [
  {
    id: DEMO_POD,
    name: "Demo families",
    version: "0.1.0",
    folder: "Documents/Pe.Tools/Pods/demo",
    entrypoints: [],
    contributions: FAMILY_NAMES.map((name) => ({
      kind: "member" as const,
      path: demoPath(name),
      memberPath: demoPath(name),
      key: `member:@${DEMO_POD}/${demoPath(name)}`,
      name: demoPath(name),
      description: null,
    })),
    members: FAMILY_NAMES.map((name, index) => ({
      path: demoPath(name),
      sha256: demoHash(index + 1),
      schema: `http://127.0.0.1:5180${FAMILY_MODEL_SCHEMA}`,
    })),
    diagnostics: [],
  },
];
