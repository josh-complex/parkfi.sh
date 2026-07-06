import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRoundIcon, SparklesIcon } from "lucide-react";

import { authClient } from "#/lib/auth-client.ts";
import { reportError } from "#/lib/report-error.ts";
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

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          callback: (token: string) => void;
          "expired-callback": () => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
    };
  }
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 fill-current" aria-hidden>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.54 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path d="M11.4 11.4H2V2h9.4v9.4z" fill="#F25022" />
      <path d="M22 11.4h-9.4V2H22v9.4z" fill="#7FBA00" />
      <path d="M11.4 22H2v-9.4h9.4V22z" fill="#00A4EF" />
      <path d="M22 22h-9.4v-9.4H22V22z" fill="#FFB900" />
    </svg>
  );
}

function OrDivider() {
  return (
    <div className="relative flex items-center gap-3">
      <div className="flex-1 border-t border-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <div className="flex-1 border-t border-border" />
    </div>
  );
}

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
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [passkeyPending, setPasskeyPending] = React.useState(false);
  const hasCaptcha = !!import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY;
  const [captchaReady, setCaptchaReady] = React.useState(!hasCaptcha);
  const turnstileToken = React.useRef<string | null>(null);
  const turnstileWidgetId = React.useRef<string | null>(null);
  const turnstileContainerRef = React.useRef<HTMLDivElement>(null);

  // Google One Tap — fires silently; email form is always available as fallback
  React.useEffect(() => {
    if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return;
    authClient.oneTap({ callbackURL: "/" }).catch(() => {});
  }, []);

  // Cloudflare Turnstile widget
  React.useEffect(() => {
    const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY as string | undefined;
    if (!siteKey || !turnstileContainerRef.current) return;

    const container = turnstileContainerRef.current;

    const initWidget = () => {
      if (!window.turnstile) return;
      turnstileWidgetId.current = window.turnstile.render(container, {
        sitekey: siteKey,
        theme: "auto",
        size: "flexible",
        callback: (token) => {
          turnstileToken.current = token;
          setCaptchaReady(true);
        },
        "expired-callback": () => {
          turnstileToken.current = null;
          setCaptchaReady(false);
        },
      });
    };

    if (window.turnstile) {
      initWidget();
    } else {
      const existing = document.querySelector('script[src*="turnstile"]');
      const script = existing ?? document.createElement("script");
      if (!existing) {
        (script as HTMLScriptElement).src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        (script as HTMLScriptElement).async = true;
        (script as HTMLScriptElement).defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", initWidget, { once: true });
    }
  }, []);

  const handlePasskey = async () => {
    setPasskeyPending(true);
    try {
      const { error } = await authClient.signIn.passkey();
      if (error) {
        const message = error.message ?? "Passkey sign-in failed";
        setError(message);
        // Flow-blocking but already surfaced inline — telemetry only, no toast.
        reportError(new Error(message), {
          source: "auth",
          severity: "critical",
          toast: false,
          context: { flow: "passkey", code: "code" in error ? error.code : undefined },
        });
      } else await navigate({ to: "/" });
    } finally {
      setPasskeyPending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    const fetchOptions = turnstileToken.current
      ? { headers: { "x-captcha-response": turnstileToken.current } }
      : undefined;

    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({ email, password, name }, fetchOptions);
        if (result.error) {
          const message = result.error.message ?? "Sign up failed";
          setError(message);
          reportError(new Error(message), {
            source: "auth",
            severity: "critical",
            toast: false,
            context: { flow: "signup", code: result.error.code },
          });
          return;
        }
      } else {
        const result = await authClient.signIn.email({ email, password }, fetchOptions);
        if (result.error) {
          const message = result.error.message ?? "Sign in failed";
          setError(message);
          reportError(new Error(message), {
            source: "auth",
            severity: "critical",
            toast: false,
            context: { flow: "password", code: result.error.code },
          });
          return;
        }
      }
      await navigate({ to: "/" });
    } finally {
      setPending(false);
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId.current);
        turnstileToken.current = null;
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <img src="/img/brand/yellow_white_marker.webp" alt="ParkFi" className="size-14" />
          <h1 className="text-xl font-semibold tracking-tight">parkfi.sh</h1>
        </div>

        <Card className="shadow-none ring-0 border border-border border-t-3">
          <CardHeader>
            <CardTitle>{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
            <CardDescription>
              {mode === "signin"
                ? "Welcome back. Sign in to your account."
                : "Create an account to save preferences and alerts."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Social providers */}
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  type="button"
                  aria-label="Sign in with Google"
                  className="flex-1"
                  disabled={!captchaReady}
                  onClick={() =>
                    void authClient.signIn.social({ provider: "google", callbackURL: "/" })
                  }
                >
                  <GoogleIcon />
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  aria-label="Sign in with Apple"
                  className="flex-1"
                  disabled={!captchaReady}
                  onClick={() =>
                    void authClient.signIn.social({ provider: "apple", callbackURL: "/" })
                  }
                >
                  <AppleIcon />
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  aria-label="Sign in with Microsoft"
                  className="flex-1"
                  disabled={!captchaReady}
                  onClick={() =>
                    void authClient.signIn.social({ provider: "microsoft", callbackURL: "/" })
                  }
                >
                  <MicrosoftIcon />
                </Button>
              </div>
              {mode === "signin" && (
                <Button
                  variant="outline"
                  type="button"
                  className="w-full gap-2"
                  disabled={passkeyPending}
                  onClick={() => void handlePasskey()}
                >
                  <KeyRoundIcon className="size-4" />
                  {passkeyPending ? "Waiting for passkey…" : "Sign in with passkey"}
                </Button>
              )}
            </div>

            <OrDivider />

            {/* Disney cast-member sign-in */}
            <div className="flex flex-col items-center gap-1">
              <Button
                type="button"
                className="w-full gap-2 bg-[#1a3c8f] text-white hover:bg-[#152f70]"
                disabled={!captchaReady}
                onClick={() =>
                  void authClient.signIn.oauth2({
                    providerId: "microsoft-disney",
                    callbackURL: "/",
                  })
                }
              >
                <SparklesIcon className="size-4" />
                Sign in with your Disney account
              </Button>
              <p className="text-xs text-muted-foreground">For Walt Disney Company cast members</p>
            </div>

            <OrDivider />

            {/* Email / password */}
            <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
              {mode === "signup" && (
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
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete={mode === "signin" ? "email" : "username"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              {/* Turnstile — invisible mode runs silently; widget only visible in test mode */}
              {hasCaptcha && (
                <div
                  className="overflow-hidden rounded-xl border border-border border-t-3"
                  style={{ height: 66 }}
                >
                  <div
                    ref={turnstileContainerRef}
                    style={{
                      margin: "-1px",
                      lineHeight: 0,
                      marginTop: "-1px",
                      transform: "scale(1.0)",
                      transformOrigin: "center",
                    }}
                  />
                </div>
              )}

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={pending || !captchaReady} className="w-full">
                {pending
                  ? mode === "signin"
                    ? "Signing in…"
                    : "Creating account…"
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </form>
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
