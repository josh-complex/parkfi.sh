import { createAuthClient } from "better-auth/react";
import { lastLoginMethodClient, oneTapClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    oneTapClient({
      clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    }),
    lastLoginMethodClient(),
  ],
});
