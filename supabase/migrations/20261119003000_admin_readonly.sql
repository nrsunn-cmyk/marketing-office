-- ADMIN-IMPL-01: 관리자 페이지 1단계(읽기 전용). 주인님 결정 DEC-13 A안(2026-11-19 13:10). 설계: Plan/Claude-Backend-20261118/ADMIN-DESIGN-01.md 3절.
--
-- 바뀌는 것
--   1) app.admins: 관리자 명단(user_id). app 스키마라 PostgREST 에 드러나지 않는다. 추가·삭제는 DB 소유자 SQL 로만(관리자를 늘리는 RPC 없음).
--   2) public.admin_access_log: 관리자가 읽을 때마다 1행(누가·어떤 RPC·조건·행 수·시각). 추가만 가능(수정·삭제는 소유자도 트리거로 거절).
--      select 는 본인 행만, 쓰기는 관리자 RPC 안에서만.
--   3) 정의자 RPC 5개(모두 맨 앞에서 auth.uid() 가 명단에 있는지 확인, 아니면 42501 FORBIDDEN, 기록·결과 없음)
--      admin_whoami()                      : 관리자인지(기록 없음, 화면 입구용)
--      admin_list_accounts(limit, 커서)     : 가입자·업무실 목록(이메일·가입일·마지막 로그인·확인 여부·업무실·고객/프로젝트/작업 수·허용 목록 여부)
--      admin_list_pending_allowlist()      : 허용 목록에 있지만 아직 가입하지 않은 이메일
--      admin_usage_summary(시작일, 끝일)    : 업무실별 개수·AI 문구 비용·자료 용량·마지막 활동(업무 내용 글 없음)
--      admin_list_audit(조건, limit, 커서)  : 감사 기록(details 안 문자열은 200자에서 자름)
--
-- 바뀌지 않는 것: 기존 표의 RLS 정책·권한(관리자에게 "모두 허용" 정책을 더하지 않는다 — 관리자도 남의 업무실 표를 직접 읽지 못한다),
--   기존 RPC, 감사 표. service_role 은 앱에 두지 않는다.
-- 열람 범위(주인님 결정): 개수·비용·시각·동작 이름만. 감사 details 문자열 200자. 2단계 인증(aal2)은 1단계에서 요구하지 않는다.
-- 정의자 함수 규칙은 22번과 같다(search_path='', auth.uid() 먼저, public·anon 실행 회수). 업무 날짜 경계는 Asia/Seoul.

-- ─────────────────────────────────────────────
-- 1) 관리자 명단
-- ─────────────────────────────────────────────
create table app.admins (
  user_id    uuid primary key references auth.users (id),
  note       text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now()
);
revoke all on app.admins from public, anon, authenticated;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from app.admins a where a.user_id = auth.uid())
$$;
revoke execute on function app.is_admin() from public, anon, authenticated;

create or replace function app.assert_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN: 관리자만 볼 수 있습니다' using errcode = '42501';
  end if;
  return auth.uid();
end $$;
revoke execute on function app.assert_admin() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2) 관리자 열람 기록(추가만)
-- ─────────────────────────────────────────────
create table public.admin_access_log (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity unique,
  admin_id    uuid not null references auth.users (id),
  rpc         text not null check (length(rpc) between 1 and 100),
  params      jsonb not null default '{}'::jsonb,
  row_count   integer not null check (row_count >= 0),
  occurred_at timestamptz not null default clock_timestamp()
);
create index admin_access_log_admin_seq on public.admin_access_log (admin_id, seq desc);
alter table public.admin_access_log enable row level security;
create policy admin_access_log_select on public.admin_access_log for select to authenticated using (admin_id = auth.uid());
revoke all on public.admin_access_log from anon;
revoke insert, update, delete, truncate on public.admin_access_log from authenticated;

create or replace function app.admin_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE_ROW: 관리자 열람 기록은 바꾸거나 지울 수 없습니다' using errcode = 'P0001';
end $$;
-- 트리거 함수도 직접 실행 권한을 회수한다(기존 app.unlink_once 와 같은 관례, RELEASE-PREP-F-01 점검에서 발견)
revoke execute on function app.admin_log_immutable() from public, anon, authenticated;
create trigger admin_access_log_no_update before update or delete on public.admin_access_log
  for each row execute function app.admin_log_immutable();
create trigger admin_access_log_no_truncate before truncate on public.admin_access_log
  for each statement execute function app.admin_log_immutable();

create or replace function app.admin_log(p_admin uuid, p_rpc text, p_params jsonb, p_rows integer) returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_access_log (admin_id, rpc, params, row_count) values (p_admin, p_rpc, coalesce(p_params, '{}'::jsonb), p_rows)
$$;
revoke execute on function app.admin_log(uuid, text, jsonb, integer) from public, anon, authenticated;

-- details 안의 문자열을 n 자에서 자른다(키·구조는 그대로). 감사 details 에 본문이 들어 있을 수 있어서
create or replace function app.jsonb_truncate_strings(p jsonb, n integer) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  t   text := jsonb_typeof(p);
  out jsonb;
  k   text;
  v   jsonb;
begin
  if t = 'string' then
    return case when length(p #>> '{}') > n then to_jsonb(left(p #>> '{}', n) || '…') else p end;
  elsif t = 'object' then
    out := '{}'::jsonb;
    for k, v in select * from jsonb_each(p) loop
      out := out || jsonb_build_object(k, app.jsonb_truncate_strings(v, n));
    end loop;
    return out;
  elsif t = 'array' then
    select coalesce(jsonb_agg(app.jsonb_truncate_strings(e, n) order by i), '[]'::jsonb) into out
      from jsonb_array_elements(p) with ordinality as x(e, i);
    return out;
  end if;
  return p;
end $$;
revoke execute on function app.jsonb_truncate_strings(jsonb, integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 3) 관리자 RPC
-- ─────────────────────────────────────────────
-- 3-1) 관리자인지(화면 입구). 기록하지 않는다. 비관리자·익명은 false(오류 아님)
create or replace function public.admin_whoami() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin()
$$;
revoke execute on function public.admin_whoami() from public, anon;
grant execute on function public.admin_whoami() to authenticated;

-- 3-2) 가입자·업무실 목록. 가입일 최신 순, 커서(가입일, id)로 다음 쪽. limit 1~200
create or replace function public.admin_list_accounts(p_limit integer default 50, p_before_created timestamptz default null, p_before_id uuid default null)
returns table (
  user_id uuid, email text, signed_up_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean,
  workspace_id uuid, workspace_name text, workspace_created_at timestamptz,
  clients integer, projects integer, tasks integer, allowlisted boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  me  uuid := app.assert_admin();
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  n   integer;
begin
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
         w.id, w.name, w.created_at,
         (select count(*)::int from public.clients c where c.workspace_id = w.id),
         (select count(*)::int from public.projects p where p.workspace_id = w.id),
         (select count(*)::int from public.tasks t where t.workspace_id = w.id),
         exists (select 1 from public.signup_allowlist a where a.email = lower(btrim(u.email)))
    from auth.users u
    left join public.workspaces w on w.owner_user_id = u.id
   where p_before_created is null or (u.created_at, u.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
   order by u.created_at desc, u.id desc
   limit lim;
  get diagnostics n = row_count;
  perform app.admin_log(me, 'admin_list_accounts', jsonb_build_object('limit', lim, 'before_created', p_before_created, 'before_id', p_before_id), n);
end $$;
revoke execute on function public.admin_list_accounts(integer, timestamptz, uuid) from public, anon;
grant execute on function public.admin_list_accounts(integer, timestamptz, uuid) to authenticated;

-- 3-3) 허용 목록에 있지만 아직 가입하지 않은 이메일(최대 500)
create or replace function public.admin_list_pending_allowlist()
returns table (email text, note text, added_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := app.assert_admin();
  n  integer;
begin
  return query
  select a.email, a.note, a.created_at
    from public.signup_allowlist a
   where not exists (select 1 from auth.users u where lower(btrim(u.email)) = a.email)
   order by a.created_at desc
   limit 500;
  get diagnostics n = row_count;
  perform app.admin_log(me, 'admin_list_pending_allowlist', '{}'::jsonb, n);
end $$;
revoke execute on function public.admin_list_pending_allowlist() from public, anon;
grant execute on function public.admin_list_pending_allowlist() to authenticated;

-- 3-4) 이용 현황: 업무실별 [시작일, 끝일] (한국 시각 날짜, 끝일 포함, 최대 366일). 개수·비용·용량·시각만
create or replace function public.admin_usage_summary(p_from date, p_to date)
returns table (
  workspace_id uuid, workspace_name text, owner_email text,
  tasks_created integer, artifact_versions_created integer, briefs_created integer,
  ai_runs integer, ai_cost_usd_micro bigint, assets_added integer, asset_bytes bigint, last_activity_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := app.assert_admin();
  t0 timestamptz;
  t1 timestamptz;
  n  integer;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION: 기간은 시작일 ≤ 끝일, 최대 366일이어야 합니다' using errcode = '22023';
  end if;
  t0 := p_from::timestamp at time zone 'Asia/Seoul';
  t1 := (p_to + 1)::timestamp at time zone 'Asia/Seoul';
  return query
  select w.id, w.name, u.email::text,
         (select count(*)::int from public.tasks x where x.workspace_id = w.id and x.created_at >= t0 and x.created_at < t1),
         (select count(*)::int from public.artifact_versions x where x.workspace_id = w.id and x.created_at >= t0 and x.created_at < t1),
         (select count(*)::int from public.content_briefs x where x.workspace_id = w.id and x.created_at >= t0 and x.created_at < t1),
         (select count(*)::int from public.brief_copy_runs x where x.workspace_id = w.id and x.created_at >= t0 and x.created_at < t1),
         (select coalesce(sum(case when x.status = 'reserved' then x.cost_estimate_usd_micro else coalesce(x.cost_usd_micro, 0) end), 0)::bigint
            from public.brief_copy_runs x where x.workspace_id = w.id and x.created_at >= t0 and x.created_at < t1),
         (select count(*)::int from public.source_assets x where x.workspace_id = w.id and x.created_at >= t0 and x.created_at < t1),
         (select coalesce(sum(x.bytes), 0)::bigint from public.source_assets x where x.workspace_id = w.id and x.created_at >= t0 and x.created_at < t1),
         (select max(e.occurred_at) from public.audit_events e where e.workspace_id = w.id)
    from public.workspaces w
    left join auth.users u on u.id = w.owner_user_id
   order by w.created_at;
  get diagnostics n = row_count;
  perform app.admin_log(me, 'admin_usage_summary', jsonb_build_object('from', p_from, 'to', p_to), n);
end $$;
revoke execute on function public.admin_usage_summary(date, date) from public, anon;
grant execute on function public.admin_usage_summary(date, date) to authenticated;

-- 3-5) 감사 기록: 조건(업무실·동작·기간), seq 큰 순, 커서 p_before_seq. limit 1~200. details 문자열 200자
create or replace function public.admin_list_audit(
  p_workspace_id uuid default null,
  p_action       text default null,
  p_from         timestamptz default null,
  p_to           timestamptz default null,
  p_limit        integer default 100,
  p_before_seq   bigint default null
) returns table (
  seq bigint, occurred_at timestamptz, workspace_id uuid, entity_type text, entity_id uuid,
  actor_id uuid, action text, revision integer, details jsonb
)
language plpgsql security definer set search_path = '' as $$
declare
  me  uuid := app.assert_admin();
  lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  n   integer;
begin
  if p_action is not null and length(p_action) > 100 then
    raise exception 'VALIDATION: 동작 이름이 너무 깁니다' using errcode = '22023';
  end if;
  return query
  select e.seq, e.occurred_at, e.workspace_id, e.entity_type, e.entity_id, e.actor_id, e.action, e.revision,
         app.jsonb_truncate_strings(e.details, 200)
    from public.audit_events e
   where (p_workspace_id is null or e.workspace_id = p_workspace_id)
     and (p_action is null or e.action = p_action)
     and (p_from is null or e.occurred_at >= p_from)
     and (p_to is null or e.occurred_at < p_to)
     and (p_before_seq is null or e.seq < p_before_seq)
   order by e.seq desc
   limit lim;
  get diagnostics n = row_count;
  perform app.admin_log(me, 'admin_list_audit',
    jsonb_build_object('workspace_id', p_workspace_id, 'action', p_action, 'from', p_from, 'to', p_to, 'limit', lim, 'before_seq', p_before_seq), n);
end $$;
revoke execute on function public.admin_list_audit(uuid, text, timestamptz, timestamptz, integer, bigint) from public, anon;
grant execute on function public.admin_list_audit(uuid, text, timestamptz, timestamptz, integer, bigint) to authenticated;
