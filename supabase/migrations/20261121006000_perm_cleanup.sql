-- PERM-CLEANUP-01 기존 public 표의 로그인 역할(authenticated) 직접 쓰기 권한 정리. 배정: Claude(master) PERM-CLEANUP-01(P3C 보고 F3).
-- 문제: Supabase 기본 권한(default privileges)이 표마다 authenticated 에 INSERT·UPDATE·DELETE·REFERENCES·TRIGGER 를 준다.
--   지금은 RLS 정책이 없어서 0행으로만 막히는 쓰기가 많다(정책이 실수로 생기면 바로 열림). 쓰기 경로는 대부분 정의자 RPC 다.
-- 근거(2026-11-20 조사, main 7bd3754 와 대기 브랜치 26cdc19·9d51286·bbd0116·f8b253e 모두 같음):
--   앱(src)이 사용자 토큰으로 직접 쓰는 표는 8개뿐:
--     clients insert·update / projects insert·update / source_assets insert·update /
--     company_profile_versions·project_profiles·supplier_profiles·tasks insert
--   public·app 스키마에서 표에 쓰는 함수는 모두 정의자(security definer)다(정의자 아닌 쓰기 함수 0) → 회수해도 RPC 는 그대로 동작한다.
--   운영 스크립트(백업·계정 만들기)는 관리 키(service_role)를 써서 영향이 없다.
-- 바꾸는 것: 아래 표의 authenticated 권한 회수만. RLS 정책·표·함수는 바꾸지 않는다(정책은 권한이 없으면 쓰이지 않는다).
--   REFERENCES·TRIGGER 는 앱이 쓰지 않으므로 모든 public 표에서 회수한다(TRIGGER 는 표에 트리거를 만들 수 있는 권한).
--   TRUNCATE 는 지금 어느 표에도 없지만 같은 줄에서 한 번 더 회수한다(RLS 가 적용되지 않는 명령).
-- 바꾸지 않는 것: SELECT, 앱이 직접 쓰는 8개 표의 해당 명령, anon(이미 0), service_role, 기본 권한 설정(default privileges).

-- 1) 쓰기를 정의자 RPC 로만 하는 표: INSERT·UPDATE·DELETE 모두 회수
revoke insert, update, delete, truncate on
  public.workspaces,
  public.templates,
  public.artifacts,
  public.artifact_versions,
  public.artifact_version_refs,
  public.approvals,
  public.generation_runs,
  public.task_input_snapshots,
  public.exports,
  public.delivery_records,
  public.quotes,
  public.quote_versions,
  public.quote_items,
  public.quote_number_sequences,
  public.company_profile_approvals,
  public.research_sources
from authenticated;

-- 2) 앱이 insert 만 하는 표(추가 전용 또는 상태는 RPC 로만 바꿈): UPDATE·DELETE 회수
revoke update, delete, truncate on
  public.company_profile_versions,
  public.project_profiles,
  public.supplier_profiles,
  public.tasks
from authenticated;

-- 3) 앱이 insert·update 하는 표(지우기는 없음, 보관은 update): DELETE 회수
revoke delete, truncate on
  public.clients,
  public.projects,
  public.source_assets
from authenticated;

-- 4) 모든 public 표: REFERENCES·TRIGGER·TRUNCATE 회수(앱이 쓰지 않음)
--    회수 직전에 표별로 원래 있었는지 기록한다(RELEASE-PLAN-02 발견: 이 migration 은 배포 순서상 맨 뒤라, 그사이 생긴 표 중에는
--    만들 때부터 REFERENCES·TRIGGER 를 회수해 둔 표가 있다. 되돌림이 "지금 SELECT 가 있는 표 전부"에 돌려주면 원래 없던 권한이 생긴다.
--    그래서 되돌림은 이 기록에 있는 것만 정확히 돌려주고 기록 표를 지운다). 사용자·익명은 이 기록 표를 읽을 수 없다
create table app.perm_cleanup_prior (
  relname        text primary key,
  had_references boolean not null,
  had_trigger    boolean not null,
  had_truncate   boolean not null,
  recorded_at    timestamptz not null default now()
);
revoke all on app.perm_cleanup_prior from public, anon, authenticated;
insert into app.perm_cleanup_prior (relname, had_references, had_trigger, had_truncate)
select c.relname, has_table_privilege('authenticated', c.oid, 'REFERENCES'), has_table_privilege('authenticated', c.oid, 'TRIGGER'),
       has_table_privilege('authenticated', c.oid, 'TRUNCATE')
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');

do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1 loop
    execute format('revoke references, trigger, truncate on public.%I from authenticated', t);
  end loop;
end $$;
