// GET /api/user?userId=123
// Returns basic user info (id, name, role) from the users table.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, role, phone, darkstore_name")
    .eq("id", userId)
    .single();

  if (error) {
    const status = error.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ data });
}
