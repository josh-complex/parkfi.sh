import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge.tsx";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/admin/blog")({
  component: AdminBlog,
  head: () => seo({ title: "Blog Review — ParkFi", noindex: true }),
});

// Browser-only editor (touches document + ships CSS) — load it on the client
// only, behind the mounted guard in PostEditor.
const MarkdownEditor = React.lazy(() => import("#/components/blog/markdown-editor.tsx"));

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d));
}

/** Markdown editor for any post (draft or published), loaded by id. */
function PostEditor({ id, onClose }: { id: number; onClose: () => void }) {
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
        void queryClient.invalidateQueries({ queryKey: trpc.blog.published.queryKey() });
        toast.success("Saved");
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

/** Inline "new post" form — creates a blank draft and opens its editor. */
function NewPostForm({ onCreated }: { onCreated: (id: number) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState("");

  const create = useMutation(
    trpc.blog.create.mutationOptions({
      onSuccess: (r) => {
        void queryClient.invalidateQueries({ queryKey: trpc.blog.drafts.queryKey() });
        setTitle("");
        toast.success("Draft created");
        onCreated(r.id);
      },
      onError: (err) => toast.error(err.message || "Could not create"),
    }),
  );

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ title: title.trim() || "Untitled post" });
      }}
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New post title…"
      />
      <Button type="submit" disabled={create.isPending}>
        New post
      </Button>
    </form>
  );
}

/** Table of published posts with edit / unpublish / delete. */
function PublishedTable({
  editingId,
  setEditingId,
}: {
  editingId: number | null;
  setEditingId: (id: number | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: posts, isLoading } = useQuery(trpc.blog.published.queryOptions());

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.blog.published.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.blog.drafts.queryKey() });
  };
  const unpublish = useMutation(
    trpc.blog.unpublish.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Moved back to drafts");
      },
      onError: (err) => toast.error(err.message || "Could not unpublish"),
    }),
  );
  const remove = useMutation(
    trpc.blog.remove.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Post deleted");
      },
      onError: (err) => toast.error(err.message || "Could not delete"),
    }),
  );
  const pending = unpublish.isPending || remove.isPending;

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = posts ?? [];
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No published posts yet.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const isEditing = editingId === p.id;
          return (
            <React.Fragment key={p.id}>
              <TableRow aria-expanded={isEditing}>
                <TableCell className="max-w-md font-medium whitespace-normal">
                  <a
                    href={`/blog/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {p.title}
                  </a>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(p.publishedAt)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {p.tags.slice(0, 3).map((t) => (
                      <Badge key={t} variant="secondary" className="font-normal">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditingId(isEditing ? null : p.id)}
                    >
                      {isEditing ? "Close" : "Edit"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => unpublish.mutate({ id: p.id })}
                    >
                      Unpublish
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`Delete "${p.title}"? This cannot be undone.`))
                          remove.mutate({ id: p.id });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              {isEditing && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal">
                    <PostEditor id={p.id} onClose={() => setEditingId(null)} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
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
        void queryClient.invalidateQueries({ queryKey: trpc.blog.published.queryKey() });
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
  const draftPosts = (drafts ?? []).filter((d) => d.status === "draft");

  if (error)
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 lg:px-6">
        <p className="text-sm text-muted-foreground">
          You don't have access to this page. (Owner accounts only.)
        </p>
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Blog</h1>
          <p className="text-sm text-muted-foreground">
            Draft, review, and manage posts. Published edits go live at the edge immediately.
          </p>
        </div>
        <NewPostForm onCreated={setEditingId} />
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Review queue
        </h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : draftPosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drafts waiting. 🎉</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {draftPosts.map((d) => {
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        {d.media.images < 2 && (
                          <Badge variant="destructive" className="font-normal">
                            media-thin · {d.media.images} img
                            {d.media.embeds > 0 ? ` · ${d.media.embeds} embed` : ""}
                          </Badge>
                        )}
                        {d.tags.map((t) => (
                          <Badge key={t} variant="secondary" className="font-normal">
                            {t}
                          </Badge>
                        ))}
                        {d.parkSlugs.map((s) => (
                          <Badge key={s} variant="outline" className="text-primary">
                            {s}
                          </Badge>
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
                      {isEditing && <PostEditor id={d.id} onClose={() => setEditingId(null)} />}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Published posts
        </h2>
        <PublishedTable editingId={editingId} setEditingId={setEditingId} />
      </section>
    </div>
  );
}
