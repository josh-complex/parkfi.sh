import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FerrisWheelIcon, KeyRoundIcon } from "lucide-react";

import { authClient } from "#/lib/auth-client.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () =>
    seo({
      title: "Sign In — ParkFi",
      description: "Sign in to ParkFi to manage alerts and personalize your park dashboard.",
      path: "/login",
      noindex: true,
    }),
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const supported =
    typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

  const handleSignIn = async () => {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        setError(result.error.message ?? "Couldn’t sign in with a passkey.");
        return;
      }
      await navigate({ to: "/" });
    } catch {
      setError("Passkey sign-in was cancelled or failed.");
    } finally {
      setPending(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      // Passkey-first registration: the server creates the account from this
      // context (see resolveUser in lib/auth.ts) and starts a session.
      const result = await authClient.passkey.addPasskey({
        name,
        context: JSON.stringify({ email, name }),
      });
      if (result?.error) {
        setError(result.error.message ?? "Couldn’t create your passkey account.");
        return;
      }
      await navigate({ to: "/" });
    } catch {
      setError("Passkey registration was cancelled or failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <FerrisWheelIcon className="size-8 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">parkfi.sh</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
            <CardDescription>
              {mode === "signin"
                ? "Use your passkey — Face ID, Touch ID, or a security key. No password."
                : "Create a passkey-secured account. We’ll never ask for a password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!supported ? (
              <p role="alert" className="text-sm text-destructive">
                This browser doesn’t support passkeys. Try a recent version of Safari, Chrome, or
                Edge.
              </p>
            ) : mode === "signin" ? (
              <div className="flex flex-col gap-4">
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  type="button"
                  disabled={pending}
                  className="w-full"
                  onClick={() => void handleSignIn()}
                >
                  <KeyRoundIcon className="size-4" />
                  {pending ? "Waiting for passkey…" : "Sign in with a passkey"}
                </Button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSignUp(e)} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username webauthn"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={pending} className="w-full">
                  <KeyRoundIcon className="size-4" />
                  {pending ? "Creating passkey…" : "Create account with a passkey"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
