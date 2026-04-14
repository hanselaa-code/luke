import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
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
        return Response.redirect(new URL("/chat", nextUrl));
      }
      return true;
    },
  },
  pages: {
    signIn: "/", // Set the custom sign-in page to the landing page
  },
});
