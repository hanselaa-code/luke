import { auth } from "@/auth";

export default auth;

export const config = {
  // Protect all routes except the landing page, static files, and icons
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icon-.*.png).*)"],
};
