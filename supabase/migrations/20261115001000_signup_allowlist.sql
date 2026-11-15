-- 회원가입·비밀번호 로그인 전환(D03 변경, 2026-11-15 사용자 지시): 허용한 이메일만 가입한다.
-- 앱도 허용 목록(ALLOWED_USER_EMAILS)을 확인하지만, 누가 앱을 거치지 않고 Supabase 가입 API를 직접 불러도
-- DB 단계에서 막도록 auth.users 에 행이 생기기 직전에 이 목록을 확인한다.
-- 목록 관리는 관리자(service_role)·DB 소유자만 한다. 일반 사용자 역할에는 아무 권한도 주지 않는다.

create table public.signup_allowlist (
  email      text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  note       text,
  created_at timestamptz not null default now()
);

alter table public.signup_allowlist enable row level security;
-- 정책을 두지 않는다 + 권한 회수: 로그인 사용자·익명 모두 읽기·쓰기 불가 (service_role 은 RLS를 우회)
revoke all on public.signup_allowlist from anon, authenticated;

create or replace function app.enforce_signup_allowlist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null
     or not exists (select 1 from public.signup_allowlist a where a.email = lower(btrim(new.email))) then
    raise exception 'SIGNUP_NOT_ALLOWED: 허용되지 않은 이메일은 가입할 수 없습니다'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function app.enforce_signup_allowlist() from public, anon, authenticated;

-- 이미 있는 계정에는 영향이 없다(새로 만들 때만 확인)
create trigger enforce_signup_allowlist
  before insert on auth.users
  for each row execute function app.enforce_signup_allowlist();
