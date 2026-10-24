import { NextResponse, type NextRequest } from "next/server";
import { createSupabase } from "@/lib/supabase";

// Runs before every page: refreshes the login cookies and sends signed-out visitors to
// /login (and signed-in ones away from it). Only a convenience: the server actions
// check the login again themselves, so the data is safe even if this doesn't run.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createSupabase({
    getAll: () => request.cookies.getAll(),
    setAll(cookies, headers) {
      // A refreshed login: pass it on to the page and back to the browser
      cookies.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
    },
  });
  const { data } = await supabase.auth.getClaims();

  // Server actions (POST) answer "signed out" themselves; a redirect would break them
  if (request.method !== "GET") return response;

  const { pathname, search } = request.nextUrl;
  let to: URL | undefined;
  if (!data && pathname !== "/login") {
    to = new URL("/login", request.url);
    // Come back to this page after signing in
    if (pathname !== "/") to.searchParams.set("next", pathname + search);
  } else if (data && pathname === "/login") {
    to = new URL("/", request.url);
  }
  if (!to) return response;

  const redirect = NextResponse.redirect(to);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  // Not for build files and images
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
