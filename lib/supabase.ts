import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

// Browser client — used in client components
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server client — used in API routes (has service role privileges)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const STORAGE_BUCKET = process.env.SUPABASE_BUCKET ?? "reqflow_images";
