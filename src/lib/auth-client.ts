import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import {
  genericOAuthClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  twoFactorClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    // Mirror the server's server-managed user fields so `session.user.role` and
    // `orgTenantId` are typed on the client. Declared literally (not via the
    // server auth type) so no server code is pulled into the client bundle.
    inferAdditionalFields({
      user: {
        role: { type: "string", required: false, input: false },
        orgTenantId: { type: "string", required: false, input: false },
      },
    }),
    // Enables authClient.signIn.oauth2() for the Disney-only Microsoft provider.
    genericOAuthClient(),
    lastLoginMethodClient(),
    twoFactorClient(),
    passkeyClient(),
  ],
});
