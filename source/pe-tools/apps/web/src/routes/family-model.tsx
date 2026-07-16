import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/family-model")({
  component: () => <Navigate to="/family" replace />,
});
