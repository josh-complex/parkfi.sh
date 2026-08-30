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

/**
 * "I have this" / "I want this" actions for a pin detail page. Logged-out users
 * get a sign-in prompt; logged-in users add the pin to the relevant list and we
 * reflect the membership inline.
 */
export function PinCollectionButtons({ pinId }: { pinId: string }) {
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

  if (!loggedIn) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <SignInPrompt label="I have this" icon={<PlusIcon />} />
        <SignInPrompt label="I want this" icon={<HeartIcon />} variant="outline" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={hasHave || addHave.isPending} onClick={() => addHave.mutate({ pinId })}>
        {hasHave ? <CheckIcon /> : <PlusIcon />}
        {hasHave ? "In your collection" : "I have this"}
      </Button>
      <Button
        variant="outline"
        disabled={hasWant || addWant.isPending}
        onClick={() => addWant.mutate({ pinId })}
      >
        {hasWant ? <CheckIcon /> : <HeartIcon />}
        {hasWant ? "On your wishlist" : "I want this"}
      </Button>
    </div>
  );
}

function SignInPrompt({
  label,
  icon,
  variant = "default",
}: {
  label: string;
  icon: React.ReactNode;
  variant?: "default" | "outline";
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant={variant} />}>
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
