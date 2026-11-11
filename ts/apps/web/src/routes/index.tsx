import { createFileRoute } from "@tanstack/react-router";
import { routeFile } from "../shell/route-file";
import { TypedShell } from "../shell/typed-shell";
import { routeAt } from "../route/registry";

const home = routeAt("/")!;
export const Route = createFileRoute("/")({
  ...routeFile("home"),
  component: () => <TypedShell module={home.module} fingerprint={home.fingerprint} />,
});
