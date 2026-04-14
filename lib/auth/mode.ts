const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE ?? "disabled";

export function isSupabaseAuthEnabled() {
  return AUTH_MODE === "supabase";
}

export function hasSupabaseCredentials() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function canUseSupabaseAuth() {
  return isSupabaseAuthEnabled() && hasSupabaseCredentials();
}
