import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy singletons — initialized on first use so module evaluation at build
// time (when env vars may not be present) does not throw.
let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

function makeClient(url: string, key: string): SupabaseClient {
  return createClient(url, key);
}

// Browser client — used in client components
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabase) {
      _supabase = makeClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    }
    const val = (_supabase as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(_supabase) : val;
  },
});

// Server client — used in API routes (has service role privileges)
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabaseAdmin) {
      _supabaseAdmin = makeClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
      );
    }
    const val = (_supabaseAdmin as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(_supabaseAdmin) : val;
  },
});

export const STORAGE_BUCKET = process.env.SUPABASE_BUCKET ?? "reqflow_images";
