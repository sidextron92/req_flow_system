import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const userIdParam = searchParams.get("userId");

  if (userIdParam && !isNaN(Number(userIdParam)) && Number(userIdParam) > 0) {
    const response = NextResponse.next();
    response.cookies.set("reqflow_userId", userIdParam, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*).*)"],
};
