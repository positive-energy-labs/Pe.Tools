import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Consider switching all to one letter params (ie "t", "m", "p"). Also think about what to do abt workbench port later. that port is really a whole-app level states, and since movingt o stable ports should ideally be removed. from url state entirely or become optional
const chatSearchParams = z.object({
  thread: z.string().optional(), // empty id = new thread
  mode: z.enum(["chat", "trace", "world"]).catch("chat"), // chat/trace/world others maybe
  prompt: z.string().optional(), // prompt text for user input box, opens many UX possibilities. prob plain trancate too-log strings, would be cool to allow attachments somehow but thats prob impossible
  // item: z.coerce.number().optional(), // TBD; id of chat item at focal point, allows point in time bookmarking, and page reload scroll position safety.
});

export const Route = createFileRoute("/chat")({
  validateSearch: chatSearchParams,
  component: RouteComponent,
});

function RouteComponent() {
  const { thread, mode, prompt } = Route.useSearch();
  return (
    <>
      <div>Hello "/chat"!</div>
      <div>thread: {thread}</div>
      <div>mode: {mode}</div>
      <div>prompt: {prompt}</div>
    </>
  );
}
