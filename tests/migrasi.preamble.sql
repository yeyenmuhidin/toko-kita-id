\set ON_ERROR_STOP on

do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role supabase_auth_admin nologin;
exception when duplicate_object then null;
end $$;

grant anon to postgres;
grant authenticated to postgres;
grant service_role to postgres;
grant supabase_auth_admin to postgres;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);
grant insert on auth.users to supabase_auth_admin;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_user
  );
$$;

grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth.uid() to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth.jwt() to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth.role() to anon, authenticated, service_role, supabase_auth_admin;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner_id text
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(object_name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(object_name, '/');
$$;

create or replace function storage.allow_any_operation(ops text[])
returns boolean
language sql
stable
as $$
  select current_setting('request.storage.operation', true) = any (ops);
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant execute on function storage.allow_any_operation(text[]) to anon, authenticated, service_role;
