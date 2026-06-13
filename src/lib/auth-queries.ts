import { queryOptions } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client.ts";

export const sessionsQueryOptions = () =>
  queryOptions({
    queryKey: ["auth", "sessions"],
    queryFn: async () => {
      const { data } = await authClient.listSessions();
      return data ?? [];
    },
    staleTime: 2 * 60 * 1000,
  });

export const passkeysQueryOptions = () =>
  queryOptions({
    queryKey: ["auth", "passkeys"],
    queryFn: async () => {
      const { data } = await authClient.passkey.listUserPasskeys();
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

export const accountsQueryOptions = () =>
  queryOptions({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const { data } = await authClient.listAccounts();
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
