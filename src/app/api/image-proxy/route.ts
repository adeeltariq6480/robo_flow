import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side image fetch proxy (avoids browser CORS when downloading
 * Pre/Result Image URLs from ShopData CSV on Stock check).
 * Does not save anything — streams bytes only.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "Only http(s) allowed" }, { status: 400 });
  }

  // Block obvious local / metadata targets
  const host = target.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.startsWith("169.254.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "AxiomAI-StockCheck/1.0",
        Accept: "image/*,*/*",
      },
      signal: AbortSignal.timeout(90_000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: 502 }
      );
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const bytes = await upstream.arrayBuffer();

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
