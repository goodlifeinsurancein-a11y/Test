-- Enforce the single-OWNER invariant at the database level.
--
-- The bootstrap endpoint first checks for an OWNER, then creates the Auth user
-- and application profile. Concurrent bootstrap requests can pass that check
-- simultaneously, so application-level checks alone are not sufficient.
-- A partial unique index makes the database the final authority.

create unique index if not exists users_single_owner_idx
  on public.users (role)
  where role = 'OWNER';
