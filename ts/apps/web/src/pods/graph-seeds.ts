import { memberWork, settingsRouteState } from "@pe/agent-contracts";
import { DEMO_BROWSE, DEMO_MEMBER_SPECS } from "./seeds";
import { DEMO_PODS, DEMO_SPEC_PATH, DEMO_RUN } from "#/route/seeds";
const values = Object.fromEntries(
  [...DEMO_MEMBER_SPECS].map(([key, spec]) => {
    const [pod, path] = key.split("|");
    return [
      JSON.stringify([pod, path]),
      { member: { pod, path }, content: spec.content, sha256: "fixture", schemaJson: spec.schema },
    ];
  }),
);
export const podsSeeds = {
  browse: {
    title: "Pods and family members",
    page: { pod: DEMO_PODS[0]!.id, path: DEMO_SPEC_PATH },
    work: settingsRouteState.schema.parse({}),
    works: Object.fromEntries(
      Object.values(values).map((read) => [
        memberWork(read.member as { pod: string; path: string }),
        settingsRouteState.schema.parse({
          basis: {
            member: read.member,
            rawContent: read.content,
            sha256: read.sha256,
            observedAt: "2026-10-30T00:00:00Z",
          },
        }),
      ]),
    ),
    readings: {
      status: null,
      pods: DEMO_BROWSE,
      member: { fixtureSelect: { fields: ["pod", "path"], values, fallback: null } },
      composition: null,
      runs: [DEMO_RUN],
      plugins: null,
    },
  },
};
