// GET /api/users/bijnisBuyers
// Returns all users with role = 'bijnisBuyer'.
// Used by the reassign bottom sheet on the requirement detail page.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, phone")
    .eq("role", "bijnisBuyer")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
