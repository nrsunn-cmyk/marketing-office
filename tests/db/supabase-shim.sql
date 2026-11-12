-- 테스트 전용: PGlite에 Supabase가 기본 제공하는 역할·auth 스키마를 흉내 낸다.
-- 운영 Supabase에는 이미 있으므로 마이그레이션에 넣지 않는다.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
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

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase 기본 권한: public의 새 테이블·함수·시퀀스는 API 역할에 권한이 열려 있다(RLS로 막는다)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
