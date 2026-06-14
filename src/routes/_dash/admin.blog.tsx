import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/admin/blog")({
  component: AdminBlog,
  head: () => seo({ title: "Blog Review — ParkFi", noindex: true }),
});

// Browser-only editor (touches document + ships CSS) — load it on the client
// only, behind the mounted guard in DraftEditor.
const MarkdownEditor = React.lazy(() => import("#/components/blog/markdown-editor.tsx"));

function DraftEditor({ id, onClose }: { id: number; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(trpc.blog.draftById.queryOptions({ id }));

  const [title, setTitle] = React.useState("");
  const [dek, setDek] = React.useState("");
  const [body, setBody] = React.useState("");
  const [heroImageUrl, setHeroImageUrl] = React.useState("");
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (data) {
      setTitle(data.title);
      setDek(data.dek);
      setBody(data.bodyMd);
      setHeroImageUrl(data.heroImageUrl ?? "");
    }
  }, [data]);

  const save = useMutation(
    trpc.blog.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.blog.draftById.queryKey({ id }) });
        void queryClient.invalidateQueries({ queryKey: trpc.blog.drafts.queryKey() });
        toast.success("Draft saved");
      },
      onError: (err) => toast.error(err.message || "Could not save"),
    }),
  );

  if (isLoading) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-4">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <Input
        value={dek}
        onChange={(e) => setDek(e.target.value)}
        placeholder="Dek / meta description"
      />
      <div className="flex flex-col gap-2">
        {heroImageUrl && (
          <img
            src={heroImageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="max-h-48 w-full rounded-lg border object-cover"
          />
        )}
        <div className="flex items-center gap-2">
          <Input
            value={heroImageUrl}
            onChange={(e) => setHeroImageUrl(e.target.value)}
            placeholder="Hero image URL (clear to remove)"
          />
          {heroImageUrl && (
            <Button size="sm" variant="ghost" onClick={() => setHeroImageUrl("")}>
              Clear
            </Button>
          )}
        </div>
        {data?.heroImageCredit && (
          <p className="text-xs text-muted-foreground">Credit: {data.heroImageCredit}</p>
        )}
      </div>
      {mounted ? (
        <React.Suspense fallback={<Skeleton className="h-[440px] w-full" />}>
          <MarkdownEditor value={body} onChange={setBody} />
        </React.Suspense>
      ) : (
        <Skeleton className="h-[440px] w-full" />
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ id, title, dek, bodyMd: body, heroImageUrl })}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function AdminBlog() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: drafts, isLoading, error } = useQuery(trpc.blog.drafts.queryOptions());
  const [editingId, setEditingId] = React.useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.blog.drafts.queryKey() });

  const approve = useMutation(
    trpc.blog.approve.mutationOptions({
      onSuccess: (r) => {
        void invalidate();
        toast.success(`Published /blog/${r.slug}`);
      },
      onError: (err) => toast.error(err.message || "Could not publish"),
    }),
  );
  const reject = useMutation(
    trpc.blog.reject.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast.success("Draft archived");
      },
      onError: (err) => toast.error(err.message || "Could not archive"),
    }),
  );

  const pending = approve.isPending || reject.isPending;
  const posts = (drafts ?? []).filter((d) => d.status === "draft");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Blog review queue</h1>
        <p className="text-sm text-muted-foreground">
          LLM-drafted posts. Edit the Markdown, then publish — published posts go live at the edge
          immediately.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-muted-foreground">
          You don't have access to this page. (Owner accounts only.)
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No drafts waiting. 🎉</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {posts.map((d) => {
            const sources = (d.sourceUrls as Array<{ title: string; url: string }>) ?? [];
            const isEditing = editingId === d.id;
            return (
              <li key={d.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{d.title}</CardTitle>
                    <CardDescription>{d.dek}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      {d.tags.map((t) => (
                        <span key={t} className="rounded-full bg-muted px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                      {d.parkSlugs.map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-primary"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    {sources.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Sources:{" "}
                        {sources.map((s, i) => (
                          <span key={s.url}>
                            {i > 0 && ", "}
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              {s.title}
                            </a>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => approve.mutate({ id: d.id })}
                      >
                        Publish
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditingId(isEditing ? null : d.id)}
                      >
                        {isEditing ? "Hide editor" : "Edit"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reject.mutate({ id: d.id })}
                      >
                        Archive
                      </Button>
                    </div>
                    {isEditing && <DraftEditor id={d.id} onClose={() => setEditingId(null)} />}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
