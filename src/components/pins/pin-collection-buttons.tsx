"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, HeartIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "#/components/ui/popover.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

/**
 * "I have this" / "I want this" actions for a pin detail page. Logged-out users
 * get a sign-in prompt; logged-in users add the pin to the relevant list and we
 * reflect the membership inline.
 *
 * `variant="key"` is the detail page's own call to action (docs/plans/
 * dining-redesign §4.7): the same two actions, with "I have this" promoted to
 * the page's one yellow key. It keeps that colour even once the pin is in the
 * collection — the key is where this action *lives*, and moving it to the
 * outline row on the second visit would make the panel rearrange itself under
 * a returning owner.
 *
 * `compact` shortens the labels for the floating phone bar, where the two keys
 * split ~340px between them: "In your collection" needs about 195px of that at
 * the bar's 15px semibold and simply does not fit beside anything.
 */
export function PinCollectionButtons({
  pinId,
  variant = "default",
  compact = false,
  className,
}: {
  pinId: string;
  variant?: "default" | "key";
  compact?: boolean;
  className?: string;
}) {
  const { data: session } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const loggedIn = !!session?.user;

  const collectionQ = useQuery({
    ...trpc.pinCollection.list.queryOptions(),
    enabled: loggedIn,
  });

  const hasHave = !!collectionQ.data?.have.some((h) => h.pinId === pinId);
  const hasWant = !!collectionQ.data?.want.some((w) => w.pinId === pinId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.pinCollection.list.queryKey() });

  const addHave = useMutation(
    trpc.pinCollection.addHave.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast.success("Added to your collection");
      },
      onError: (err) => toast.error(err.message || "Could not add pin"),
    }),
  );

  const addWant = useMutation(
    trpc.pinCollection.addWant.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast.success("Added to your wishlist");
      },
      onError: (err) => toast.error(err.message || "Could not add pin"),
    }),
  );

  const isKey = variant === "key";
  const size = isKey ? ("lg" as const) : ("default" as const);
  const haveLabel = compact
    ? hasHave
      ? "Collected"
      : "Have it"
    : hasHave
      ? "In your collection"
      : "I have this";
  const wantLabel = compact
    ? hasWant
      ? "Wishlisted"
      : "Want it"
    : hasWant
      ? "On your wishlist"
      : "I want this";

  if (!loggedIn) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <SignInPrompt
          label={haveLabel}
          icon={<PlusIcon />}
          variant={isKey ? "yellow" : "default"}
          size={size}
        />
        <SignInPrompt label={wantLabel} icon={<HeartIcon />} variant="outline" size={size} />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        variant={isKey ? "yellow" : "default"}
        size={size}
        className={cn(isKey && "font-bold")}
        disabled={hasHave || addHave.isPending}
        onClick={() => addHave.mutate({ pinId })}
      >
        {hasHave ? <CheckIcon /> : <PlusIcon />}
        {haveLabel}
      </Button>
      <Button
        variant="outline"
        size={size}
        className={cn(isKey && "font-bold")}
        disabled={hasWant || addWant.isPending}
        onClick={() => addWant.mutate({ pinId })}
      >
        {hasWant ? <CheckIcon /> : <HeartIcon />}
        {wantLabel}
      </Button>
    </div>
  );
}

function SignInPrompt({
  label,
  icon,
  variant = "default",
  size = "default",
}: {
  label: string;
  icon: React.ReactNode;
  variant?: "default" | "outline" | "yellow";
  size?: "default" | "lg";
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant={variant} size={size} className="font-bold" />}>
        {icon}
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="space-y-3">
          <PopoverHeader>
            <PopoverTitle>Sign in to track pins</PopoverTitle>
            <PopoverDescription>
              Your collection and wishlist are tied to your account.
            </PopoverDescription>
          </PopoverHeader>
          <Button size="sm" className="w-full" render={<LoginLink />}>
            Sign in
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
