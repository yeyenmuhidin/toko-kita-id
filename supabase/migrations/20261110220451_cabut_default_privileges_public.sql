-- Belum dijalankan ke proyek jarak jauh xlsbhvpveivhbqikmxxp.
-- Hanya mengubah default privileges untuk objek yang dibuat setelah migrasi ini.
-- GRANT pada tabel, sequence, dan fungsi yang sudah ada tidak diubah.
-- service_role tidak dicabut. PUBLIC pada fungsi baru juga tidak dicabut.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

DO $cabut_supabase_admin$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    RAISE NOTICE 'role supabase_admin tidak ada; default privileges peran itu tidak diubah';
    RETURN;
  END IF;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'default privileges supabase_admin tidak diubah: %', SQLERRM;
END
$cabut_supabase_admin$;
