import type { SettingsFieldState } from "@pe/agent-contracts";
import { FAMILY_DEMO_PODS, familyDemoFields } from "#/family/seeds";
import { familyFixtures } from "#/family/authored-families";
import { DEMO_FAMILIES_SPEC } from "#/families/seeds";
import {
  DEMO_FAMILIES_SPEC_PATH,
  DEMO_FRAGMENTS,
  DEMO_PODS,
  DEMO_SPEC,
  DEMO_SPEC_PATH,
} from "#/route/seeds";

export interface DemoMember {
  content: string;
  schema: string;
  fields?: Record<string, SettingsFieldState>;
}
export const DEMO_BROWSE = [...DEMO_PODS, ...FAMILY_DEMO_PODS];
export const DEMO_MEMBER_SPECS = new Map<string, DemoMember>([
  [`${DEMO_PODS[0]!.id}|${DEMO_SPEC_PATH}`, DEMO_SPEC],
  [`${DEMO_PODS[0]!.id}|${DEMO_FAMILIES_SPEC_PATH}`, DEMO_FAMILIES_SPEC],
  ...Object.entries(DEMO_FRAGMENTS).map(
    ([path, spec]) => [`${DEMO_PODS[0]!.id}|${path}`, spec] as const,
  ),
  ...FAMILY_DEMO_PODS[0]!.members.map((member) => {
    const content =
      familyFixtures[
        member.path
          .split("/")
          .at(-1)!
          .replace(/\.json$/, "") as never
      ];
    return [
      `${FAMILY_DEMO_PODS[0]!.id}|${member.path}`,
      {
        content,
        schema: "",
        fields: familyDemoFields(content),
      },
    ] as const;
  }),
]);
