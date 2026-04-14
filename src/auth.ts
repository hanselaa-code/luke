import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  debug: true,
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
        let publicBase = process.env.AUTH_URL;
        if (!publicBase || publicBase.includes("0.0.0.0")) {
           publicBase = "https://luke--luke-b5b5d.europe-west4.hosted.app"; // Strong fallback to ensure prod works
        }
        // If nextUrl has a bad origin due to proxy, construct from public base
        if (nextUrl.origin.includes("0.0.0.0") || nextUrl.origin.includes("localhost:8080")) {
           return Response.redirect(new URL("/chat", publicBase));
        }
        return Response.redirect(new URL("/chat", nextUrl));
      }
      return true;
    },
    async redirect({ url, baseUrl }) {
      console.log("[Auth.js Redirect Callback] Evaluated url:", url, "baseUrl:", baseUrl);
      
      let publicBaseUrl = process.env.AUTH_URL;
      if (!publicBaseUrl || publicBaseUrl.includes("0.0.0.0")) {
          publicBaseUrl = "https://luke--luke-b5b5d.europe-west4.hosted.app";
      }
      
      // Override internal host patterns in baseUrl
      let currentBaseUrl = baseUrl;
      if (currentBaseUrl.includes("0.0.0.0") || currentBaseUrl.includes("localhost:8080")) {
          currentBaseUrl = publicBaseUrl;
      }

      console.log("[Auth.js Redirect Callback] Final currentBaseUrl used:", currentBaseUrl);

      // Relative urls
      if (url.startsWith("/")) {
        return `${currentBaseUrl}${url}`;
      }
      
      // Absolute urls
      try {
        const urlObj = new URL(url);
        // If the URL goes to our bad internal origin, replace it with the public base
        if (urlObj.origin.includes("0.0.0.0") || urlObj.origin.includes("localhost:8080")) {
           return `${currentBaseUrl}${urlObj.pathname}${urlObj.search}`;
        }
        // If it's on the same intended public origin or actual baseUrl
        if (urlObj.origin === currentBaseUrl || urlObj.origin === publicBaseUrl) {
           return url;
        }
      } catch (e) {
        console.error("[Auth.js Redirect Callback] URL parse error:", e);
      }
      
      return currentBaseUrl; // Default safe fallback
    }
  },
  pages: {
    signIn: "/", // Set the custom sign-in page to the landing page
  },
});
