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
          scope: "openid profile email https://www.googleapis.com/auth/calendar.readonly",
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      }
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Persist the Google access token to the token right after signin
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      // Send properties to the client/server session object
      // We will need this to authenticate API calls to Google
      if (token?.accessToken) {
        session.accessToken = token.accessToken as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const protectedRoutes = ["/chat", "/calendar", "/settings"];
      const isProtected = protectedRoutes.some(route => nextUrl.pathname.startsWith(route));

      if (isProtected && !isLoggedIn) {
        return false; // Redirect unauthenticated users to login
      }
      return true;
    },
  },
  pages: {
    signIn: "/", // Set the custom sign-in page to the landing page
  },
});
