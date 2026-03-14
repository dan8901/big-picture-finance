import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page, auth API, and cron endpoints through
  if (pathname === "/login" || pathname === "/api/auth" || pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Auth not configured — allow through (dev convenience)
    return NextResponse.next();
  }

  const token = request.cookies.get("auth_token")?.value;
  const expectedToken = createHmac("sha256", secret)
    .update("authenticated")
    .digest("hex");

  if (token !== expectedToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
