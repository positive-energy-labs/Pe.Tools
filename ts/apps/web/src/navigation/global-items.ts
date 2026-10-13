import { CATALOGUE } from "./model";
import type { NavigationSnapshot } from "./navigation-client";

export type ResultKind = "All" | "Tools" | "Works" | "Pea threads";
export type Destination = {
  key: string;
  kind: Exclude<ResultKind, "All">;
  label: string;
  context: string;
  aliases: string;
  state: string;
  url: string | null;
  reason: string | null;
};
export function globalItems(snapshot: NavigationSnapshot | null, kind: ResultKind): Destination[] {
  return [
    ...(kind === "All" || kind === "Tools"
      ? CATALOGUE.map((tool) => ({
          key: `tool:${tool.to}`,
          kind: "Tools" as const,
          label: tool.title,
          context: tool.task,
          aliases: `${tool.aliases} ${tool.description}`,
          state: tool.exposure,
          url: tool.to,
          reason: null,
        }))
      : []),
    ...(kind === "All" || kind === "Works"
      ? (snapshot?.works ?? []).map((work) => ({
          key: `work:${work.id}`,
          kind: "Works" as const,
          label: work.label,
          context: work.context,
          aliases: work.route,
          state: work.state,
          url: work.url,
          reason: work.reason,
        }))
      : []),
    ...(kind === "All" || kind === "Pea threads"
      ? (snapshot?.threads ?? []).map((thread) => ({
          key: `thread:${thread.id}`,
          kind: "Pea threads" as const,
          label: thread.label,
          context: thread.context,
          aliases: "pea chat thread",
          state: thread.state,
          url: thread.url,
          reason: thread.reason,
        }))
      : []),
  ];
}
