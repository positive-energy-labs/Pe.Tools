import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/family-model")({
  component: () => <Navigate to="/beta/family-plugin" replace />,
});
