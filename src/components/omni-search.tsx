import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";

import { useTRPC } from "#/integrations/trpc/react.ts";
import { Input } from "#/components/ui/input.tsx";
import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

import type { FC } from "react";

export const OmniSearch: FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const navigate = useNavigate();
  const trpc = useTRPC();

  const searchQ = useQuery({
    ...trpc.search.global.queryOptions({ q: query }),
    enabled: query.length > 0,
  });

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleParkClick = (slug: string) => {
    navigate({ to: "/park/$slug", params: { slug } });
    setIsOpen(false);
    setQuery("");
  };

  const handleAttractionClick = (parkSlug: string) => {
    navigate({ to: "/park/$slug", params: { slug: parkSlug } });
    setIsOpen(false);
    setQuery("");
  };

  const handleDiningClick = () => {
    navigate({ to: "/dining" });
    setIsOpen(false);
    setQuery("");
  };

  const handleBlogClick = (slug: string) => {
    navigate({ to: "/blog/$slug", params: { slug } });
    setIsOpen(false);
    setQuery("");
  };

  const hasResults =
    (searchQ.data?.parks?.length ?? 0) > 0 ||
    (searchQ.data?.attractions?.length ?? 0) > 0 ||
    (searchQ.data?.dining?.length ?? 0) > 0 ||
    (searchQ.data?.blogPosts?.length ?? 0) > 0;

  return (
    <>
      <div className="w-full">
        <button
          onClick={() => setIsOpen(true)}
          className="relative w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:max-w-sm"
        >
          <div className="flex items-center gap-2">
            <SearchIcon className="size-4 shrink-0" />
            <span className="hidden text-left sm:inline">Search parks, rides...</span>
            <span className="inline text-left sm:hidden">Search...</span>
            <kbd className="ml-auto hidden h-5 select-none items-center gap-1 rounded border border-muted bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 md:flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </div>
        </button>
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />
          <div className="fixed inset-x-0 top-0 z-50 mx-auto max-w-2xl">
            <div className="rounded-lg border border-border bg-background shadow-lg">
              <div className="flex items-center border-b border-border px-4 py-3">
                <SearchIcon className="size-5 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search parks, attractions, dining, blog posts..."
                  className="ml-2 border-0 bg-transparent focus-visible:ring-0"
                />
                {query && (
                  <Button variant="ghost" size="sm" onClick={() => setQuery("")} className="ml-2">
                    <XIcon className="size-4" />
                  </Button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto">
                {searchQ.isLoading && query ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Searching...
                  </div>
                ) : !hasResults && query ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No results found
                  </div>
                ) : (
                  <>
                    {(searchQ.data?.parks?.length ?? 0) > 0 && (
                      <div className="border-b border-border">
                        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Parks
                        </div>
                        {searchQ.data?.parks?.map((park) => (
                          <button
                            key={park.id}
                            onClick={() => handleParkClick(park.slug)}
                            className={cn(
                              "w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                              "transition-colors border-b border-border last:border-0",
                            )}
                          >
                            {park.name}
                          </button>
                        ))}
                      </div>
                    )}

                    {(searchQ.data?.attractions?.length ?? 0) > 0 && (
                      <div className="border-b border-border">
                        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Attractions
                        </div>
                        {searchQ.data?.attractions?.map((attr) => (
                          <button
                            key={attr.id}
                            onClick={() => handleAttractionClick(attr.parkSlug)}
                            className={cn(
                              "w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                              "transition-colors border-b border-border last:border-0",
                            )}
                          >
                            <div className="font-medium">{attr.name}</div>
                            <div className="text-xs text-muted-foreground">{attr.parkName}</div>
                          </button>
                        ))}
                      </div>
                    )}

                    {(searchQ.data?.dining?.length ?? 0) > 0 && (
                      <div className="border-b border-border">
                        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Dining
                        </div>
                        {searchQ.data?.dining?.map((venue) => (
                          <button
                            key={venue.id}
                            onClick={handleDiningClick}
                            className={cn(
                              "w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                              "transition-colors border-b border-border last:border-0",
                            )}
                          >
                            <div className="font-medium">{venue.name}</div>
                            <div className="text-xs text-muted-foreground">{venue.parkName}</div>
                          </button>
                        ))}
                      </div>
                    )}

                    {(searchQ.data?.blogPosts?.length ?? 0) > 0 && (
                      <div>
                        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Blog
                        </div>
                        {searchQ.data?.blogPosts?.map((post) => (
                          <button
                            key={post.id}
                            onClick={() => handleBlogClick(post.slug)}
                            className={cn(
                              "w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                              "transition-colors border-b border-border last:border-0",
                            )}
                          >
                            {post.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {!query && (
                <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
                  Type to search across parks, attractions, dining, and blog posts
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};
