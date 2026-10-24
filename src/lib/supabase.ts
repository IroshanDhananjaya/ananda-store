import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";

// Login uses Supabase Auth (free plan). Users are added in the Supabase dashboard; there is
// no sign-up page. The login lives in cookies: src/proxy.ts refreshes them on page loads, and
// the server actions (src/lib/actions.ts) check them on every call.

/** Supabase client that reads and writes the login cookies through `cookies` */
export function createSupabase(cookies: CookieMethodsServer) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set. Copy them from your Supabase project (Project Settings > API Keys) into .env.local.",
    );
  return createServerClient(url, key, { cookies });
}
