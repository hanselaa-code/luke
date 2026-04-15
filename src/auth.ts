import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          // SCOPE CHANGE: Expanded to full calendar access for event creation
          scope: "openid profile email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly",
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      }
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Initial sign-in: Capture tokens and expiry
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at ? account.expires_at * 1000 : 0, // Store in ms
        };
      }

      // Subsequent access: Check if token has expired
      // If it hasn't expired yet, return the current token
      if (token.expiresAt && Date.now() < (token.expiresAt as number)) {
        return token;
      }

      // If the access token has expired, try to refresh it
      console.log("[AUTH] Access token expired. Attempting refresh...");
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      // Pass the fresh access token and any error to the session object
      if (token?.accessToken) {
        session.accessToken = token.accessToken as string;
      }
      if (token?.error) {
        session.error = token.error as "RefreshTokenError";
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const protectedRoutes = ["/chat", "/calendar", "/settings"];
      const isProtected = protectedRoutes.some(route => nextUrl.pathname.startsWith(route));

      if (isProtected && !isLoggedIn) {
        return false;
      }
      return true;
    },
  },
  pages: {
    signIn: "/",
  },
});

/**
 * Silent Refresh Logic: 
 * Requests a new access token from Google using the stored refresh token.
 */
async function refreshAccessToken(token: any) {
  try {
    const url = "https://oauth2.googleapis.com/token";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID!,
        client_secret: process.env.AUTH_GOOGLE_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    console.log("[AUTH] Token refreshed successfully.");

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
      // Fall back to old refresh token if a new one isn't provided
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("[AUTH] Error refreshing access token", error);

    return {
      ...token,
      error: "RefreshTokenError",
    };
  }
}
