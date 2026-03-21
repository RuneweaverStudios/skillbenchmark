-- Add GitHub access token to profiles for API access (repo listing, etc.)
ALTER TABLE public.profiles ADD COLUMN github_access_token TEXT;

-- Only the user themselves and service_role can see/update the token
CREATE POLICY profiles_token_select ON public.profiles
    FOR SELECT USING (id = auth.uid());

-- Note: The existing profiles_read policy allows SELECT for all,
-- but the token column should only be read by the owning user.
-- Since column-level security isn't available in Postgres RLS,
-- the API layer must filter this field for non-owner queries.
