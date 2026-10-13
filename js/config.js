// Connection to the Supabase project (Project Settings, API).
// The anon key is meant to be public: access is enforced by the row level
// security rules in supabase/schema.sql, not by keeping this file secret.
// While supabaseUrl is empty the site runs in demo mode on local browser storage.
export const config = {
  supabaseUrl: 'https://qyuinwidetufdyrjcjba.supabase.co',
  supabaseAnonKey: 'sb_publishable_eXWTr7mxGygwbdAX4SGRZg_yLmW_eC1',
  // Logins are by name. Supabase needs an email, so "Joan" signs in as joan@<loginDomain>.
  // The accounts were created with this domain: changing it locks everyone out.
  loginDomain: 'familiekalender.example',
};
