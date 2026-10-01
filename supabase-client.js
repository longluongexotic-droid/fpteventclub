import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';

// Public browser credentials. The build substitutes these two values from
// SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY).
// Never use a service_role or secret key here.
export const SUPABASE_URL = '__SUPABASE_URL__';
export const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

export const isSupabaseConfigured = (() => {
  try {
    const url = new URL(SUPABASE_URL);
    return url.protocol === 'https:' && Boolean(url.hostname) &&
      !url.username && !url.password &&
      !SUPABASE_ANON_KEY.startsWith('__') && SUPABASE_ANON_KEY.length > 40;
  } catch { return false; }
})();

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  : null;
