import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  CheckIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client.ts";
import { generateBotAvatar } from "#/lib/avatar.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";
import { ConfirmButton } from "#/components/account/confirm-button.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { toast } from "sonner";
import { usePrevious } from "@dnd-kit/utilities";

export const Route = createFileRoute("/_dash/account/profile")({
  component: ProfilePage,
  head: () =>
    seo({
      title: "Profile — Account Settings — ParkFi",
      path: "/account/profile",
      noindex: true,
    }),
});

function userInitials(name: string | null | undefined, email: string) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  return (email[0] ?? "U").toUpperCase();
}

type PendingAvatar = { src: string; type: "bot" | "photo" };

function ProfilePage() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const trpc = useTRPC();

  const user = session?.user as
    | { id: string; name: string | null; email: string; image?: string | null }
    | undefined;

  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState(user?.image ?? generateBotAvatar(user?.id ?? ""));
  const [pending, setPending] = useState<PendingAvatar | null>(null);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadAvatar = useMutation(trpc.uploads.avatar.mutationOptions());

  if (!user) return null;

  const handleSaveName = async () => {
    setSaving(true);
    const { error } = await authClient.updateUser({ name });
    setSaving(false);
    if (error) toast.error(error.message ?? "Failed to update name");
    else toast.success("Display name updated");
  };

  const generateBot = () =>
    setPending({ src: generateBotAvatar(crypto.randomUUID()), type: "bot" });

  const handleUploadAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const SIZE = 256;
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d")!;
        const side = Math.min(img.width, img.height);
        ctx.drawImage(
          img,
          (img.width - side) / 2,
          (img.height - side) / 2,
          side,
          side,
          0,
          0,
          SIZE,
          SIZE,
        );
        setPending({ src: canvas.toDataURL("image/jpeg", 0.9), type: "photo" });
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirm = async () => {
    if (!pending) return;
    setConfirmSaving(true);
    try {
      let imageUrl = pending.src;
      if (pending.type === "photo") {
        const { url } = await uploadAvatar.mutateAsync({ dataUri: pending.src });
        imageUrl = url;
      }
      const { error } = await authClient.updateUser({ image: imageUrl });
      if (error) toast.error(error.message ?? "Failed to save avatar");
      else {
        setAvatarSrc(imageUrl);
        setPending(null);
        toast.success("Avatar updated");
      }
    } catch {
      toast.error("Failed to save avatar");
    } finally {
      setConfirmSaving(false);
    }
  };

  const displaySrc = pending?.src ?? avatarSrc;
  const lastSrc = usePrevious(displaySrc);

  return (
    <div className="space-y-4">
      {/* Avatar */}
      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
          <CardDescription>Your bot avatar or a custom photo</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-5">
            {/* Avatar with spinner overlay and cancel badge */}
            <div className="relative shrink-0">
              <Avatar className="size-20 rounded-full after:hidden border border-border shadow-[0_3px_0_0_color-mix(in_oklch,var(--border),var(--border)),inset_0_1px_0_0_oklch(1_0_0/0.55)]">
                <AvatarImage src={displaySrc} alt="Your avatar" />
                <AvatarFallback className="rounded-full text-2xl">
                  <Avatar className="size-20 rounded-full after:hidden border border-border shadow-[0_3px_0_0_color-mix(in_oklch,var(--border),var(--border)),inset_0_1px_0_0_oklch(1_0_0/0.55)]">
                    <AvatarImage src={lastSrc} alt="Your avatar" />
                    <AvatarFallback className="rounded-full text-2xl">
                      {userInitials(user.name, user.email)}
                    </AvatarFallback>
                  </Avatar>
                </AvatarFallback>
              </Avatar>
              {confirmSaving && (
                <div className="absolute inset-0 rounded-full bg-background/70 flex items-center justify-center">
                  <LoaderCircleIcon className="size-5 animate-spin text-foreground" />
                </div>
              )}
              {pending && !confirmSaving && (
                <button
                  onClick={() => setPending(null)}
                  className="absolute -top-1 -right-1 size-5 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Cancel"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                variant={pending ? "default" : "outline"}
                onClick={pending ? () => void handleConfirm() : generateBot}
                disabled={confirmSaving}
              >
                {pending ? (
                  <>
                    <CheckIcon /> Save
                  </>
                ) : (
                  <>
                    <RefreshCwIcon /> Randomize bot
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={
                  pending?.type === "bot" ? generateBot : () => fileInputRef.current?.click()
                }
                disabled={confirmSaving}
              >
                {pending?.type === "bot" ? (
                  <>
                    <RefreshCwIcon /> Try another
                  </>
                ) : (
                  <>
                    <UploadIcon /> Upload photo
                  </>
                )}
              </Button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUploadAvatar}
            />
          </div>
        </CardContent>
      </Card>

      {/* Display name */}
      <Card>
        <CardHeader>
          <CardTitle>Display name</CardTitle>
          <CardDescription>Shown in the sidebar and notifications</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="max-w-xs"
            />
            <Button
              onClick={() => void handleSaveName()}
              disabled={saving || name === (user.name ?? "")}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle>Email address</CardTitle>
          <CardDescription>Your sign-in address</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{user.email}</p>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>
            Permanently delete your account and all data. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmButton
            label="Delete account"
            confirmLabel="Yes, delete"
            icon={<TrashIcon />}
            onConfirm={async () => {
              const { error } = await authClient.deleteUser({ callbackURL: "/login" });
              if (error) toast.error(error.message ?? "Failed to delete account");
              else await navigate({ to: "/login" });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
