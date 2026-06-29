import { type NextRequest, NextResponse } from "next/server";
import { isFirebaseConfigured } from "@/lib/firebase/config";

// No-auth mode: all pages are public. We only redirect to /setup-error
// when Firebase is not configured at all.
export async function updateSession(request: NextRequest) {
  if (!isFirebaseConfigured()) {
    if (request.nextUrl.pathname !== "/setup-error") {
      const url = request.nextUrl.clone();
      url.pathname = "/setup-error";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}
