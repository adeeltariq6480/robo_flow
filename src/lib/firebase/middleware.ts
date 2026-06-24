import { type NextRequest, NextResponse } from "next/server";
import { isFirebaseConfigured } from "@/lib/firebase/config";

const PUBLIC_PATHS = ["/login", "/register", "/setup-error"];

export async function updateSession(request: NextRequest) {
  if (!isFirebaseConfigured()) {
    if (request.nextUrl.pathname !== "/setup-error") {
      const url = request.nextUrl.clone();
      url.pathname = "/setup-error";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isPublic) {
    return NextResponse.next();
  }

  const session = request.cookies.get("__session")?.value;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
