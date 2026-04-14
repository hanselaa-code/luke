import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  debug: process.env.NODE_ENV === "development" || true, // Enable for now to help diagnosis
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLandingPage = nextUrl.pathname === "/";
      const protectedRoutes = ["/chat", "/calendar", "/settings"];
      const isProtected = protectedRoutes.some(route => nextUrl.pathname.startsWith(route));

      if (isProtected) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to login
      } else if (isLoggedIn && isOnLandingPage) {
        const baseUrl = process.env.AUTH_URL || nextUrl.origin;
        // Ensure we don't redirect to an internal host like 0.0.0.0:8080
        if (baseUrl.includes("0.0.0.0") || baseUrl.includes("localhost:8080")) {
           return Response.redirect(new URL("/chat", nextUrl)); // Fallback to relative-ish
        }
        return Response.redirect(new URL("/chat", baseUrl));
      }
      return true;
    },
  },
  pages: {
    signIn: "/", // Set the custom sign-in page to the landing page
  },
});
