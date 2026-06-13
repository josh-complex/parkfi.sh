import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/account/")({
  beforeLoad: () => {
    throw redirect({ to: "/account/profile" });
  },
});
