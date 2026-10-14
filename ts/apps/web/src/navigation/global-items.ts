import { APP_ROUTES } from "@pe/agent-contracts";
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
      ? APP_ROUTES.filter((tool) => tool.directory || tool.key === "machine").map((tool) => ({
          key: `tool:${tool.path}`,
          kind: "Tools" as const,
          label: tool.title,
          context: tool.task,
          aliases: `${tool.aliases} ${tool.description}`,
          state: tool.exposure,
          url: tool.path,
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
          aliases: `pea chat thread ${thread.id}`,
          state: thread.state,
          url: thread.url,
          reason: thread.reason,
        }))
      : []),
  ];
}
/** What a destination is called: matched first, at word starts or as a substring. */
export const destinationLabel = (destination: Destination) => destination.label;
/** Its group, aliases, description and state: matched only where a query word starts a word. */
export const destinationDetail = (destination: Destination) =>
  `${destination.context} ${destination.aliases} ${destination.state}`;
