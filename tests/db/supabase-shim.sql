-- 테스트 전용: PGlite에 Supabase가 기본 제공하는 역할·auth 스키마를 흉내 낸다.
-- 운영 Supabase에는 이미 있으므로 마이그레이션에 넣지 않는다.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique,
  -- 실제 Supabase auth.users 에도 있는 열(관리자 목록 ADMIN-IMPL-01 이 읽는다)
  created_at         timestamptz default now(),
  last_sign_in_at    timestamptz,
  email_confirmed_at timestamptz
);

-- Supabase의 auth.uid()와 같은 방식으로 JWT의 sub를 읽는다
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

-- Supabase Storage 의 최소 흉내 (버킷·객체 테이블, RLS 켜짐)
create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  -- 실제 Supabase 처럼 크기·형식을 담는다(size, mimetype). 직접 업로드 확정 RPC 가 대조한다
  metadata   jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase 기본 권한: public의 새 테이블·함수·시퀀스는 API 역할에 권한이 열려 있다(RLS로 막는다)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
