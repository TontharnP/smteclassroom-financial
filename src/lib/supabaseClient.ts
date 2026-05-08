import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
	// Surface a clear warning in dev; avoid throwing to keep components mountable.
	// eslint-disable-next-line no-console
	console.warn(
		"[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Hydration and CRUD will fail until set in .env.local"
	);
}

// Use placeholder values when env vars are missing to allow build to complete
// The app will warn at runtime but won't crash during static generation
export const supabase = createClient(
	supabaseUrl || "https://placeholder.supabase.co",
	supabaseKey || "placeholder-anon-key"
);
