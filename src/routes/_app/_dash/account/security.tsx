import { createFileRoute } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useState } from "react";
import {
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  KeyRoundIcon,
  TrashIcon,
  LaptopIcon,
  LogOutIcon,
  MonitorIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client.ts";
import { passkeysQueryOptions, sessionsQueryOptions } from "#/lib/auth-queries.ts";
import { seo } from "#/lib/seo.ts";
import { ConfirmButton } from "#/components/account/confirm-button.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "#/components/ui/input-otp.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/_dash/account/security")({
  component: SecurityPage,
  head: () =>
    seo({
      title: "Security — Account Settings — ParkFi",
      path: "/account/security",
      noindex: true,
    }),
});

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function ChangePasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const handleChange = async () => {
    if (next !== confirm) {
      toast.error("New passwords don't match");
      return;
    }
    setSaving(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: false,
    });
    setSaving(false);
    if (error) toast.error(error.message ?? "Failed to change password");
    else {
      toast.success("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  };

  if (!hasPassword) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set a password</CardTitle>
          <CardDescription>
            You signed up with a social provider. Add a password to enable email sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Use a strong, unique password you don't use elsewhere</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-w-xs">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button
            onClick={() => void handleChange()}
            disabled={saving || !current || !next || !confirm}
          >
            {saving ? "Saving…" : "Update password"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSet = async () => {
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setSaving(true);
    const { error } = await (
      authClient as unknown as {
        setPassword: (a: { password: string }) => Promise<{ error: { message?: string } | null }>;
      }
    ).setPassword({ password });
    setSaving(false);
    if (error) toast.error(error.message ?? "Failed to set password");
    else toast.success("Password set — you can now sign in with email + password");
  };

  return (
    <div className="space-y-3 max-w-xs">
      <div className="space-y-1.5">
        <Label>New password</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Confirm password</Label>
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <Button onClick={() => void handleSet()} disabled={saving || !password || !confirm}>
        {saving ? "Saving…" : "Set password"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2FA
// ---------------------------------------------------------------------------

type TotpPhase =
  | { phase: "idle" }
  | { phase: "passwordPrompt" }
  | { phase: "setup"; uri: string; qrDataUrl: string; secret: string }
  | { phase: "done"; backupCodes: string[] };

function extractSecret(totpUri: string): string {
  try {
    return new URL(totpUri).searchParams.get("secret") ?? totpUri;
  } catch {
    return totpUri;
  }
}

function TwoFactorCard({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const [phase, setPhase] = useState<TotpPhase>({ phase: "idle" });
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);

  const startSetup = async (pw: string) => {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.getTotpUri({ password: pw });
    setBusy(false);
    if (error || !data?.totpURI) {
      toast.error(error?.message ?? "Failed to get TOTP URI — check your password");
      return;
    }
    const qrDataUrl = await QRCode.toDataURL(data.totpURI, { width: 200, margin: 1 });
    setPhase({ phase: "setup", uri: data.totpURI, qrDataUrl, secret: extractSecret(data.totpURI) });
  };

  const handleVerify = async () => {
    setBusy(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: otp });
    if (error) {
      setBusy(false);
      toast.error(error.message ?? "Invalid code — try again");
      setOtp("");
      return;
    }
    const { data: bcData } = await authClient.twoFactor.generateBackupCodes({ password });
    setBusy(false);
    setPhase({ phase: "done", backupCodes: bcData?.backupCodes ?? [] });
    onToggle();
    toast.success("Two-factor authentication enabled");
  };

  const handleDisable = async () => {
    setBusy(true);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Failed to disable 2FA — check your password");
    } else {
      setPassword("");
      setPhase({ phase: "idle" });
      onToggle();
      toast.success("Two-factor authentication disabled");
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    setRegenerating(false);
    if (error) toast.error(error.message ?? "Failed to regenerate backup codes");
    else {
      setNewCodes(data?.backupCodes ?? []);
      toast.success("New backup codes generated — save them now");
    }
  };

  // Post-enable: show backup codes
  if (phase.phase === "done") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-green-500" />
            Two-factor authentication enabled
            <Badge variant="secondary" className="text-green-600 bg-green-100 dark:bg-green-900/30">
              Active
            </Badge>
          </CardTitle>
          <CardDescription>
            Save these backup codes somewhere safe — each one can only be used once.
          </CardDescription>
        </CardHeader>
        {phase.backupCodes.length > 0 && (
          <CardContent>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-sm bg-muted rounded-2xl p-4 select-all">
              {phase.backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </CardContent>
        )}
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => setPhase({ phase: "idle" })}>
            Done
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Add a second layer of security using an authenticator app
          </CardDescription>
        </CardHeader>

        <CardContent>
          {phase.phase === "idle" && (
            <Button size="sm" onClick={() => setPhase({ phase: "passwordPrompt" })}>
              Enable 2FA
            </Button>
          )}

          {phase.phase === "passwordPrompt" && (
            <div className="space-y-3 max-w-xs">
              <p className="text-xs text-muted-foreground">Confirm your password to begin setup:</p>
              <Input
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && password) void startSetup(password);
                }}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void startSetup(password)}
                  disabled={busy || !password}
                >
                  {busy ? "Loading…" : "Continue"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPhase({ phase: "idle" });
                    setPassword("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {phase.phase === "setup" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Scan with Google Authenticator, 1Password, Authy, or any TOTP app:
                </p>
                <img
                  src={phase.qrDataUrl}
                  alt="TOTP QR code"
                  className="rounded-2xl size-[200px] border"
                />
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    Can't scan? Enter manually
                  </summary>
                  <code className="block mt-2 font-mono bg-muted rounded-xl px-3 py-2 break-all select-all text-foreground">
                    {phase.secret}
                  </code>
                </details>
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="text-xs font-medium">
                  Enter the 6-digit code from your app to verify:
                </p>
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleVerify()}
                    disabled={busy || otp.length < 6}
                  >
                    {busy ? "Verifying…" : "Verify & enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPhase({ phase: "idle" });
                      setOtp("");
                      setPassword("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // 2FA enabled — management
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-green-500" />
          Two-factor authentication
          <Badge variant="secondary" className="text-green-600 bg-green-100 dark:bg-green-900/30">
            Active
          </Badge>
        </CardTitle>
        <CardDescription>Your account is protected with an authenticator app</CardDescription>
      </CardHeader>

      {newCodes.length > 0 && (
        <CardContent>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            New backup codes — save these now:
          </p>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-sm bg-muted rounded-2xl p-4 select-all">
            {newCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </CardContent>
      )}

      <CardContent>
        <div className="space-y-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleRegenerate()}
            disabled={regenerating || !password}
          >
            <RefreshCwIcon />
            {regenerating ? "Generating…" : "Regenerate backup codes"}
          </Button>

          <Separator />

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Enter your password to disable 2FA:</p>
            <div className="flex gap-2 flex-wrap">
              <Input
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="max-w-xs"
                autoComplete="current-password"
              />
              <ConfirmButton
                label="Disable 2FA"
                confirmLabel="Yes, disable"
                disabled={!password}
                onConfirm={() => void handleDisable()}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function PasskeysSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-7 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="size-7 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function PasskeysCard() {
  const queryClient = useQueryClient();
  const opts = passkeysQueryOptions();
  const { data: passkeys = [], isLoading } = useQuery(opts);
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    const { error } = await authClient.passkey.addPasskey();
    setAdding(false);
    if (error) toast.error(error.message ?? "Failed to register passkey");
    else {
      toast.success("Passkey registered");
      await queryClient.invalidateQueries({ queryKey: opts.queryKey });
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) toast.error(error.message ?? "Failed to remove passkey");
    else {
      toast.success("Passkey removed");
      queryClient.setQueryData(
        opts.queryKey,
        passkeys.filter((p) => p.id !== id),
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
        <CardDescription>Sign in with Face ID, Touch ID, or a hardware key</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <PasskeysSkeleton />
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground mb-4">
            No passkeys registered yet. Add one to enable passwordless sign-in.
          </p>
        ) : (
          <ul className="space-y-1 mb-4">
            {passkeys.map((pk) => (
              <li
                key={pk.id}
                className="flex items-center justify-between rounded-2xl bg-muted/50 px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <KeyRoundIcon className="size-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{pk.name ?? "Passkey"}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {pk.deviceType === "multiDevice" ? "Synced across devices" : "Single-device"}{" "}
                      · Added {formatDate(pk.createdAt)}
                    </p>
                  </div>
                </div>
                <ConfirmButton
                  label=""
                  confirmLabel="Remove"
                  size="icon"
                  variant="outline"
                  icon={<TrashIcon className="size-3.5" />}
                  onConfirm={() => handleDelete(pk.id)}
                />
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" onClick={() => void handleAdd()} disabled={adding}>
          <PlusIcon />
          {adding ? "Registering…" : "Add passkey"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function parseUserAgent(ua: string | null | undefined) {
  if (!ua) return { browser: "Unknown", os: "Unknown", icon: MonitorIcon };
  const lower = ua.toLowerCase();
  let browser = "Browser";
  let os = "Unknown";
  let icon: typeof MonitorIcon = MonitorIcon;

  if (lower.includes("iphone") || lower.includes("ipad")) {
    os = lower.includes("ipad") ? "iPad" : "iPhone";
    icon = SmartphoneIcon;
  } else if (lower.includes("android")) {
    os = "Android";
    icon = SmartphoneIcon;
  } else if (lower.includes("mac")) {
    os = "macOS";
    icon = LaptopIcon;
  } else if (lower.includes("windows")) {
    os = "Windows";
  } else if (lower.includes("linux")) {
    os = "Linux";
  }

  if (lower.includes("chrome") && !lower.includes("edg") && !lower.includes("opr"))
    browser = "Chrome";
  else if (lower.includes("safari") && !lower.includes("chrome")) browser = "Safari";
  else if (lower.includes("firefox")) browser = "Firefox";
  else if (lower.includes("edg")) browser = "Edge";
  else if (lower.includes("opr") || lower.includes("opera")) browser = "Opera";

  return { browser, os, icon };
}

type SessionItem = {
  id: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
};

function SessionsSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-8 rounded-xl shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="size-7 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function SessionsCard() {
  const { data: session } = authClient.useSession();
  const currentToken = session?.session.token ?? "";

  const queryClient = useQueryClient();
  const opts = sessionsQueryOptions();
  const { data: sessions = [], isLoading } = useQuery(opts);

  const others = (sessions as SessionItem[]).filter((s) => s.token !== currentToken);

  const handleRevoke = async (token: string) => {
    const { error } = await authClient.revokeSession({ token });
    if (error) toast.error(error.message ?? "Failed to revoke session");
    else {
      toast.success("Session revoked");
      queryClient.setQueryData(
        opts.queryKey,
        (sessions as SessionItem[]).filter((s) => s.token !== token),
      );
    }
  };

  const handleRevokeAll = async () => {
    const { error } = await authClient.revokeOtherSessions();
    if (error) toast.error(error.message ?? "Failed to revoke sessions");
    else {
      toast.success("All other sessions revoked");
      queryClient.setQueryData(
        opts.queryKey,
        (sessions as SessionItem[]).filter((s) => s.token === currentToken),
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices and browsers currently signed in to your account</CardDescription>
        {!isLoading && others.length > 0 && (
          <CardAction>
            <ConfirmButton
              label="Revoke all others"
              confirmLabel="Yes, revoke"
              icon={<LogOutIcon />}
              variant="outline"
              onConfirm={() => void handleRevokeAll()}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SessionsSkeleton />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <ul className="space-y-1">
            {(sessions as SessionItem[]).map((s) => {
              const isCurrent = s.token === currentToken;
              const { browser, os, icon: DeviceIcon } = parseUserAgent(s.userAgent);
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-2xl bg-muted/50 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-xl bg-background border flex items-center justify-center shrink-0">
                      <DeviceIcon className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium">
                          {browser} on {os}
                        </p>
                        {isCurrent && (
                          <Badge variant="secondary" className="text-xs h-4 px-1.5">
                            This device
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.ipAddress ? `${s.ipAddress} · ` : ""}
                        Signed in {formatDate(s.createdAt)} · Expires {formatDate(s.expiresAt)}
                      </p>
                    </div>
                  </div>
                  {!isCurrent && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => void handleRevoke(s.token)}
                    >
                      <LogOutIcon className="size-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function SecurityPage() {
  const { data: session } = authClient.useSession();
  const user = session?.user as { id: string; twoFactorEnabled?: boolean | null } | undefined;
  const [twoFaEnabled, setTwoFaEnabled] = useState(user?.twoFactorEnabled ?? false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const { data } = await authClient.listAccounts();
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const hasPassword = accounts.some((a) => a.providerId === "credential");

  return (
    <div className="space-y-4">
      <ChangePasswordCard hasPassword={hasPassword} />
      {/* 2FA enrollment requires confirming a password, so it's only usable once
          the user has set one — hide it for social-only accounts. */}
      {hasPassword && (
        <TwoFactorCard enabled={twoFaEnabled} onToggle={() => setTwoFaEnabled((v) => !v)} />
      )}
      <PasskeysCard />
      <SessionsCard />
    </div>
  );
}
