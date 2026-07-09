import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRoundIcon, Loader2Icon, SparklesIcon } from "lucide-react";

import { authClient } from "#/lib/auth-client.ts";
import { reportError } from "#/lib/report-error.ts";
import { AppleIcon, GoogleIcon, MicrosoftIcon } from "#/components/account/provider-icons.tsx";
import { CastMemberBlockedDialog } from "#/components/account/cast-member-blocked-dialog.tsx";
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

// OAuth failures come back as a full-page redirect to /login with `?error=…`
// (and sometimes `?error_description=…`). Map the codes we care about to
// human-readable copy; everything else falls back to a generic message.
// The admin-consent case is the important one: Entra blocks a cast member whose
// tenant hasn't approved ParkFi before our callback ever runs, and surfaces an
// AADSTS65001/90094 code in the description.
function messageForOAuthError(error: string, description: string | null): string {
  const desc = description ?? "";
  if (/AADSTS(65001|90094|900941)/.test(desc) || /admin (consent|approval)/i.test(desc)) {
    return "Your organization hasn't approved ParkFi yet, so Microsoft blocked the sign-in. A Walt Disney Company IT admin needs to grant access before Cast Member sign-in will work.";
  }
  if (error === "access_denied") {
    return "Sign-in was cancelled, or your organization declined access to ParkFi. You can still continue as a regular guest.";
  }
  return "We couldn't complete that sign-in. Please try again, or use another method below.";
}

// Consent / admin-approval / access-denied failures get the reframing modal
// (CastMemberBlockedDialog); any other OAuth error falls through to the inline
// alert. These are the codes Entra returns when a tenant blocks the app.
function isCastMemberBlock(error: string, description: string | null): boolean {
  const desc = description ?? "";
  return (
    error === "access_denied" ||
    error === "consent_required" ||
    /AADSTS(65001|65004|90094|900941)/.test(desc) ||
    /consent|admin (consent|approval)/i.test(desc)
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
  // OAuth failures redirect back here with `?error=…` (and sometimes
  // `?error_description=…`); parse them so the component can react.
  validateSearch: (
    search: Record<string, unknown>,
  ): { error?: string; error_description?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
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
  const search = Route.useSearch();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [blockedMessage, setBlockedMessage] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [passkeyPending, setPasskeyPending] = React.useState(false);
  const hasCaptcha = !!import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY;
  // Managed Turnstile is silent on the happy path — only reveal the widget box
  // when CF actually escalates to an interactive challenge.
  const [captchaInteractive, setCaptchaInteractive] = React.useState(false);
  const turnstileToken = React.useRef<string | null>(null);
  const turnstileWidgetId = React.useRef<string | null>(null);
  const turnstileContainerRef = React.useRef<HTMLDivElement>(null);
  // Submitters that clicked before the captcha resolved. Resolved with the token once
  // it arrives, or rejected if Turnstile escalates to an interactive challenge.
  const captchaWaiters = React.useRef<
    Array<{ resolve: (token: string) => void; reject: () => void }>
  >([]);

  // Returns the captcha token immediately if ready, otherwise resolves when it arrives.
  // Rejects if the widget switches to an interactive challenge (pending submit is aborted).
  const waitForCaptchaToken = React.useCallback((): Promise<string | null> => {
    if (!hasCaptcha || turnstileToken.current) return Promise.resolve(turnstileToken.current);
    return new Promise((resolve, reject) => captchaWaiters.current.push({ resolve, reject }));
  }, [hasCaptcha]);

  // Surface OAuth redirect failures: better-auth sends them back to /login with
  // `?error=…`. Consent/admin-approval blocks open the reframing modal; anything
  // else shows inline. Either way, strip the params afterward so a refresh
  // doesn't re-show a stale error.
  React.useEffect(() => {
    const oauthError = search.error;
    if (!oauthError) return;
    const desc = search.error_description ?? null;
    const message = messageForOAuthError(oauthError, desc);
    if (isCastMemberBlock(oauthError, desc)) {
      setBlockedMessage(message);
    } else {
      setError(message);
    }
    void navigate({ to: "/login", search: {}, replace: true });
  }, [search.error, search.error_description, navigate]);

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
          setCaptchaInteractive(false);
          captchaWaiters.current.forEach((w) => w.resolve(token));
          captchaWaiters.current = [];
        },
        "expired-callback": () => {
          turnstileToken.current = null;
        },
        "before-interactive-callback": () => {
          setCaptchaInteractive(true);
          // A challenge is now required — abort any in-flight submit so the user
          // solves the checkbox and clicks Sign in again with a fresh token.
          captchaWaiters.current.forEach((w) => w.reject());
          captchaWaiters.current = [];
        },
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

    // Submit can be clicked before the captcha resolves — keep the spinner up and
    // wait for the token rather than blocking the button. But if Turnstile escalates
    // to an interactive challenge, abort: the button disables (captchaInteractive)
    // until the user solves the checkbox, then they click Sign in again.
    let captchaToken: string | null;
    try {
      captchaToken = await waitForCaptchaToken();
    } catch {
      setPending(false);
      return;
    }
    const fetchOptions = captchaToken
      ? { headers: { "x-captcha-response": captchaToken } }
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
      <CastMemberBlockedDialog
        open={blockedMessage !== null}
        onOpenChange={(o) => {
          if (!o) setBlockedMessage(null);
        }}
        description={blockedMessage ?? ""}
      />
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
                  onClick={() =>
                    void authClient.signIn.social({
                      provider: "microsoft",
                      callbackURL: "/",
                      errorCallbackURL: "/login",
                    })
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
                  {passkeyPending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <KeyRoundIcon className="size-4" />
                  )}
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
                onClick={() =>
                  void authClient.signIn.oauth2({
                    providerId: "microsoft-disney",
                    callbackURL: "/",
                    errorCallbackURL: "/login",
                  })
                }
              >
                <SparklesIcon className="size-4" />
                Sign in with your Disney account
              </Button>
              <p className="text-xs text-muted-foreground">
                Content moderated by Walt Disney Company cast members
              </p>
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
              <Button
                type="submit"
                disabled={pending || captchaInteractive}
                className="w-full gap-2"
              >
                {pending && <Loader2Icon className="size-4 animate-spin" />}
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
