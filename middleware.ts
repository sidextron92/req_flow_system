import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const userIdParam = searchParams.get("userId");

  // If ?userId is in the URL, persist it as a cookie on the response so that
  // the server-side /api/manifest route can read it immediately — even before
  // any client-side JS runs. This ensures the manifest's start_url is baked
  // with the correct userId when Safari fetches it during HTML parsing.
  if (userIdParam && !isNaN(Number(userIdParam)) && Number(userIdParam) > 0) {
    const response = NextResponse.next();
    response.cookies.set("reqflow_userId", userIdParam, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: "lax",
      httpOnly: false, // must be readable by client-side JS too
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Run on all page routes but skip static files, API routes, and _next internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*).*)"],
};
