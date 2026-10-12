import { createFileRoute } from "@tanstack/react-router";
import { OpenPage } from "#/open/route";

export const Route = createFileRoute("/open")({ component: OpenPage });
