import { routeAddress, type SubjectRefCode } from "@pe/agent-contracts";
export function fansLink(ids: SubjectRefCode[], search: Readonly<Record<string, unknown>>) {
  return routeAddress("fans").link({
    ...Object.fromEntries(
      ["target", "fixture", "thread"].flatMap((key) =>
        typeof search[key] === "string" ? [[key, search[key]]] : [],
      ),
    ),
    fan: { kind: "ids", ids },
  });
}
