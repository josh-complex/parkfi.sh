import { Link, createFileRoute } from "@tanstack/react-router";
import { BellRing, FileText, ShieldAlert, Trophy } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/admin/")({
  component: AdminDashboard,
  head: () => seo({ title: "Admin — ParkFi", noindex: true }),
});

interface AdminTool {
  title: string;
  description: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: AdminTool[] = [
  {
    title: "Blog",
    description: "Draft, review, and publish posts. Edits go live at the edge immediately.",
    to: "/admin/blog",
    icon: FileText,
  },
  {
    title: "Removal Requests",
    description:
      "Action content-removal requests from cast members and take features offline for maintenance.",
    to: "/admin/removal-requests",
    icon: ShieldAlert,
  },
  {
    title: "Achievements",
    description: "Inspect user stats and revoke achievement unlocks for testing.",
    to: "/admin/achievements",
    icon: Trophy,
  },
  {
    title: "Alerts",
    description: "Run alert sweeps on demand and fire test push/dining notifications.",
    to: "/admin/alerts",
    icon: BellRing,
  },
];

function AdminDashboard() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">Internal tooling. Owner accounts only.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link key={tool.to} to={tool.to} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/40">
              <CardHeader>
                <tool.icon className="size-6 text-muted-foreground transition-colors group-hover:text-primary" />
                <CardTitle className="mt-2">{tool.title}</CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
