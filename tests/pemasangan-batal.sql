\set ON_ERROR_STOP on
begin;
\ir ../supabase/pemasangan/toko_kita_pemasangan_awal.sql
select 1/0;
