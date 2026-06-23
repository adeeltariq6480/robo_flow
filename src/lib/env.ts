/**
 * Supabase environment variables.
 * Uses ANON_KEY (legacy) or PUBLISHABLE_KEY (new Supabase dashboard naming).
 */

const PLACEHOLDER_PATTERNS = [
  "your-project-ref",
  "your-anon",
  "your-publishable",
  "your-service-role",
  "your-secret",
  "example.com",
];

function isPlaceholder(value: string | undefined): boolean {
  if (!value || value.trim() === "") return true;
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
}

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (isPlaceholder(url)) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Create .env.local in the project root (not .env.example)."
    );
  }
  return url!;
}

export function getSupabaseAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (isPlaceholder(key)) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy the anon/publishable key from Supabase Dashboard → Settings → API into .env.local."
    );
  }
  return key!;
}

export function getSupabaseServiceRoleKey(): string | undefined {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY;
  return isPlaceholder(key) ? undefined : key;
}

export function isSupabaseConfigured(): boolean {
  try {
    getSupabaseUrl();
    getSupabaseAnonKey();
    return true;
  } catch {
    return false;
  }
}
