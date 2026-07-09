import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRoundIcon, SparklesIcon } from "lucide-react";

import { authClient } from "#/lib/auth-client.ts";
import { reportError } from "#/lib/report-error.ts";
import { AppleIcon, GoogleIcon, MicrosoftIcon } from "#/components/account/provider-icons.tsx";
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
          "before-interactive-callback"?: () => void;
          "after-interactive-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
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
  // Managed Turnstile is silent on the happy path — only reveal the widget box
  // when CF actually escalates to an interactive challenge.
  const [captchaInteractive, setCaptchaInteractive] = React.useState(false);
  const turnstileToken = React.useRef<string | null>(null);
  const turnstileWidgetId = React.useRef<string | null>(null);
  const turnstileContainerRef = React.useRef<HTMLDivElement>(null);

  // Cloudflare Turnstile widget
  React.useEffect(() => {
    const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY as string | undefined;
    if (!siteKey || !turnstileContainerRef.current) return;

    const container = turnstileContainerRef.current;

    const initWidget = () => {
      if (!window.turnstile) return;
      // Guard against a second render() into the same container (StrictMode / HMR / remount),
      // which orphans the live challenge iframe and leaves a dead response input behind.
      if (turnstileWidgetId.current) return;
      turnstileWidgetId.current = window.turnstile.render(container, {
        sitekey: siteKey,
        theme: "auto",
        size: "flexible",
        callback: (token) => {
          turnstileToken.current = token;
          setCaptchaReady(true);
          setCaptchaInteractive(false);
        },
        "expired-callback": () => {
          turnstileToken.current = null;
          setCaptchaReady(false);
        },
        "before-interactive-callback": () => setCaptchaInteractive(true),
        "after-interactive-callback": () => setCaptchaInteractive(false),
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

    return () => {
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
        setCaptchaReady(false);
      }
    };
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

              {/* Turnstile (Managed) — silent on the happy path; the box expands into
                  view only when CF escalates to an interactive challenge. */}
              {hasCaptcha && (
                <div
                  className={
                    captchaInteractive
                      ? "overflow-hidden rounded-xl border border-border border-t-3"
                      : "overflow-hidden"
                  }
                  style={{ height: captchaInteractive ? 66 : 0 }}
                >
                  <div
                    ref={turnstileContainerRef}
                    style={{
                      margin: "-1px",
                      lineHeight: 0,
                      marginTop: "-1px",
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
