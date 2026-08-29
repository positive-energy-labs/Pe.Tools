import { createFileRoute } from "@tanstack/react-router";
import { ScheduleGridRoute } from "#/schedule-grid/route";

export const Route = createFileRoute("/schedule-grid")({
  validateSearch: (search: Record<string, unknown>): { thread?: string } => ({
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  }),
  component: ScheduleGridRoute,
});
