import { createFileRoute } from "@tanstack/react-router";
import { Directory } from "#/navigation/directory";

export const Route = createFileRoute("/")({ component: Directory });
