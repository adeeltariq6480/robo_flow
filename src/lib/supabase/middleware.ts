import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from "@/lib/env";

const PUBLIC_ROUTES = ["/login", "/signup", "/auth/callback", "/setup-error"];

type CookieToSet = { name: string; value: string; options: CookieOptions };

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  // Strip Next.js internal params (_rsc, etc.) so RSC requests don't break
  url.search = "";
  return NextResponse.redirect(url);
}

function isRscRequest(request: NextRequest) {
  return (
    request.headers.get("RSC") === "1" ||
    request.nextUrl.searchParams.has("_rsc")
  );
}

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    if (request.nextUrl.pathname === "/setup-error") {
      return NextResponse.next();
    }
    return redirectTo(request, "/setup-error");
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
  const isProtected =
    pathname.startsWith("/projects") || pathname.startsWith("/dashboard");

  // Let the home page Server Component handle logged-in redirect for RSC requests
  if (isRscRequest(request) && pathname === "/") {
    return supabaseResponse;
  }

  if (!user && isProtected) {
    return redirectTo(request, "/login");
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return redirectTo(request, "/projects");
  }

  if (!user && !isPublic && pathname !== "/") {
    return redirectTo(request, "/login");
  }

  return supabaseResponse;
}
