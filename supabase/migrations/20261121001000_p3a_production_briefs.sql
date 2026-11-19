-- P3A-BACKEND-01 공통 제작 브리프(P3-a) 서버. 설계: Plan/Claude-Backend-20261120/P3A-BACKEND-01-DESIGN.md (Master 수락)
-- 범위: 마스터 플랜 P3 첫 단계. 홈페이지·디자인 자산·영상·PPT 가 공통으로 쓰는 제작 입력을 프로젝트 단위로 둔다.
--   AI 호출 없음(Master Q8): 손으로만 쓴다. 외부 요청·파일 저장소 없음.
--
-- 바뀌는 것
--   1) production_briefs: 승인된 전략 결과물 하나를 바탕으로 만드는 제작 브리프(프로젝트 1 : N, 보관 안 된 것 10개까지).
--      상태 drafting·ready(화면 '작성 중'·'확정'), 보관은 archived_at(되돌리기 없음), 삭제 없음.
--      만들 때 바탕 판 정보를 사본(source_snapshot)으로 고정한다. 전략 승인본이 바뀌면 경고만(DEC-P2-01-A), 맞추기는 수동 rebase.
--   2) artifacts 에 unique(project_id, id) 추가(브리프의 복합 FK 용 — 다른 프로젝트의 전략을 가리킬 수 없게).
--   3) select 만 본인 업무실, 직접 쓰기 회수. 쓰기는 정의자 RPC 4개만, RPC 마다 감사 1행(entity_type 'production_brief', 본문 없음).
--
-- 바뀌지 않는 것: 기존 표 데이터, 기존 RPC 본문과 인자, 관리자 RPC(D10).
-- 잠금: 만들기는 프로젝트 행 FOR SHARE(보관과 겹침 방지) + 프로젝트별 advisory lock(한도 계산), 나머지는 브리프 한 행만 FOR UPDATE.
--   다른 RPC 는 이 표를 잠그지 않고, 프로젝트·전략·작업은 읽기만 하므로 기존 잠금 순서와 얽히지 않는다(D12).
--
-- 정의자 함수 규칙(P2 와 같음): search_path='' 고정·스키마 표기, 맨 앞 auth.uid() 확인,
--   소유 조건을 조회 WHERE 안에 넣어 남의 행은 잠그지 않음, 남의 것·없는 것은 같은 NOT_FOUND, public·anon 실행 권한 회수.

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 포함 산출물 종류: 1~4개, 정해진 넷 중에서, 중복·null 없음(뒤 단계 표 이름과 같다 — D4)
create or replace function app.production_kinds_ok(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  -- NULL 이 나오면 CHECK 가 통과하므로 false 로 바꾼다(Tester QA-P3A-PREP-01 D1)
  select coalesce(p is not null
     and cardinality(p) between 1 and 4
     and array_position(p, null) is null
     and p <@ array['web_copy', 'design_assets', 'video_plan', 'ppt_deck']::text[]
     and (select count(distinct x) from unnest(p) x) = cardinality(p), false)
$$;
revoke execute on function app.production_kinds_ok(text[]) from public, anon;

-- 바탕 사본: {"strategy_version": 양의 정수, "profile_ref"?: 객체} 만
create or replace function app.production_snapshot_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  -- {} 처럼 strategy_version 이 없으면 비교가 NULL 이 되어 CHECK 를 통과하므로 false 로 바꾼다(Tester QA-P3A-PREP-01 D1)
  select coalesce(jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'strategy_version') = 'number'
     and (p ->> 'strategy_version') ~ '^[1-9][0-9]*$'
     and (not p ? 'profile_ref' or jsonb_typeof(p -> 'profile_ref') = 'object')
     and not exists (select 1 from jsonb_object_keys(p) k where k not in ('strategy_version', 'profile_ref')), false)
$$;
revoke execute on function app.production_snapshot_ok(jsonb) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
alter table public.artifacts add constraint artifacts_project_id_id_key unique (project_id, id);

create table public.production_briefs (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null,
  project_id             uuid not null,
  strategy_artifact_id   uuid not null,
  strategy_version_id    uuid not null,
  title                  text not null check (length(title) between 1 and 120 and title = app.funnel_trim(title)),
  target_audience        text not null check (length(target_audience) between 1 and 500 and target_audience = app.funnel_trim(target_audience)),
  core_message           text not null check (length(core_message) between 1 and 1000 and core_message = app.funnel_trim(core_message)),
  deliverable_types      text[] not null check (app.production_kinds_ok(deliverable_types)),
  scope_summary          text not null check (length(scope_summary) between 1 and 2000 and scope_summary = app.funnel_trim(scope_summary)),
  brand_tone_constraints text check (brand_tone_constraints is null or (length(brand_tone_constraints) between 1 and 1000 and brand_tone_constraints = app.funnel_trim(brand_tone_constraints))),
  reference_notes        text check (reference_notes is null or (length(reference_notes) between 1 and 1000 and reference_notes = app.funnel_trim(reference_notes))),
  status                 text not null default 'drafting' check (status in ('drafting', 'ready')),
  source_snapshot        jsonb not null check (app.production_snapshot_ok(source_snapshot)),
  archived_at            timestamptz,
  revision               integer not null default 1,
  created_by             uuid not null references auth.users (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  -- 전략 결과물은 같은 프로젝트의 것, 전략 판은 그 결과물의 판이어야 한다
  foreign key (project_id, strategy_artifact_id) references public.artifacts (project_id, id),
  foreign key (strategy_artifact_id, strategy_version_id) references public.artifact_versions (artifact_id, id),
  unique (workspace_id, id),
  unique (project_id, id)
);
create index production_briefs_active on public.production_briefs (project_id, created_at) where archived_at is null;
create index production_briefs_strategy on public.production_briefs (strategy_artifact_id);

-- 바탕은 전략 결과물이어야 한다(FK 는 종류를 못 본다 — Tester R-Q4). 바탕 열은 고정이라 넣을 때만 본다
create or replace function app.production_brief_strategy_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.artifacts a where a.id = new.strategy_artifact_id and a.type = 'strategy') then
    raise exception 'VALIDATION: 제작 브리프의 바탕은 전략이어야 합니다' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function app.production_brief_strategy_only() from public, anon, authenticated;
create trigger production_briefs_strategy_only before insert on public.production_briefs
  for each row execute function app.production_brief_strategy_only();

create trigger production_briefs_guard before update on public.production_briefs
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'strategy_artifact_id', 'created_by', 'created_at');

-- 보관한 브리프는 어떤 칸도 바꿀 수 없다(보관 되돌리기 포함). guard 보다 먼저 돈다(이름 순서)
create or replace function app.production_brief_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 제작 브리프는 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.production_brief_frozen() from public, anon, authenticated;
create trigger production_briefs_frozen before update on public.production_briefs
  for each row execute function app.production_brief_frozen();

-- ─────────────────────────────────────────────
-- 2) RLS·권한: select 만 본인 업무실, 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.production_briefs enable row level security;
create policy production_briefs_select on public.production_briefs for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.production_briefs from anon;
revoke insert, update, delete, truncate on public.production_briefs from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미 (정의자 RPC 안에서만 부른다)
-- ─────────────────────────────────────────────
-- 프로젝트·바탕 전략이 열려 있는지(D13): 프로젝트 보관 아님, 전략 작업 취소 아님
create or replace function app.assert_production_open(p_project_id uuid, p_strategy_artifact_id uuid) returns void
language plpgsql stable set search_path = '' as $$
declare
  ps text;
  ts text;
begin
  select p.status into ps from public.projects p where p.id = p_project_id;
  if ps = 'archived' then
    raise exception 'INVALID_TRANSITION: 보관한 프로젝트의 제작 브리프는 고칠 수 없습니다. 프로젝트를 다시 열어 주세요' using errcode = 'P0001';
  end if;
  select k.status into ts from public.artifacts a join public.tasks k on k.id = a.task_id where a.id = p_strategy_artifact_id;
  if ts = 'cancelled' then
    raise exception 'INVALID_TRANSITION: 취소된 전략 작업의 제작 브리프는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
end $$;
revoke execute on function app.assert_production_open(uuid, uuid) from public, anon, authenticated;

-- 값 검사(문구를 구체적으로 돌려주려고 CHECK 앞에서 한 번 더 본다). 정리 전 값을 받는다
create or replace function app.check_production_brief(
  p_title text, p_target_audience text, p_core_message text, p_deliverable_types text[], p_scope_summary text,
  p_brand_tone_constraints text, p_reference_notes text, p_status text
) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(length(app.funnel_trim(p_title)), 0) not between 1 and 120 then
    raise exception 'VALIDATION: 제목은 1~120자여야 합니다' using errcode = '22023';
  end if;
  if coalesce(length(app.funnel_trim(p_target_audience)), 0) not between 1 and 500 then
    raise exception 'VALIDATION: 핵심 대상은 1~500자여야 합니다' using errcode = '22023';
  end if;
  if coalesce(length(app.funnel_trim(p_core_message)), 0) not between 1 and 1000 then
    raise exception 'VALIDATION: 핵심 전달 메시지는 1~1000자여야 합니다' using errcode = '22023';
  end if;
  if p_deliverable_types is null or cardinality(p_deliverable_types) = 0 then
    raise exception 'VALIDATION: 포함 산출물을 1개 이상 골라 주세요' using errcode = '22023';
  end if;
  if array_position(p_deliverable_types, null) is not null
     or not (p_deliverable_types <@ array['web_copy', 'design_assets', 'video_plan', 'ppt_deck']::text[]) then
    raise exception 'VALIDATION: 알 수 없는 산출물 종류입니다' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_deliverable_types) x) <> cardinality(p_deliverable_types) then
    raise exception 'VALIDATION: 같은 산출물을 두 번 고를 수 없습니다' using errcode = '22023';
  end if;
  if coalesce(length(app.funnel_trim(p_scope_summary)), 0) not between 1 and 2000 then
    raise exception 'VALIDATION: 제작 범위는 1~2000자여야 합니다' using errcode = '22023';
  end if;
  if p_brand_tone_constraints is not null and length(app.funnel_trim(p_brand_tone_constraints)) > 1000 then
    raise exception 'VALIDATION: 브랜드 톤·금기 사항은 1000자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_reference_notes is not null and length(app.funnel_trim(p_reference_notes)) > 1000 then
    raise exception 'VALIDATION: 참고 자료 안내는 1000자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('drafting', 'ready') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
end $$;
revoke execute on function app.check_production_brief(text, text, text, text[], text, text, text, text) from public, anon, authenticated;

-- 승인본 판 정보 사본
create or replace function app.production_snapshot(p_version_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'strategy_version', v.version,
           'profile_ref', case when jsonb_typeof(v.content -> 'profileRef') = 'object' then v.content -> 'profileRef' end))
    from public.artifact_versions v where v.id = p_version_id
$$;
revoke execute on function app.production_snapshot(uuid) from public, anon, authenticated;

create or replace function app.production_brief_audit(p_ws uuid, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'production_brief', p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.production_brief_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

-- 브리프 하나를 본인 것만 잠근다(없거나 남의 것이면 NOT_FOUND)
create or replace function app.lock_own_production_brief(p_brief_id uuid) returns public.production_briefs
language plpgsql set search_path = '' as $$
declare
  b public.production_briefs%rowtype;
begin
  select x.* into b
    from public.production_briefs x
   where x.id = p_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 제작 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return b;
end $$;
revoke execute on function app.lock_own_production_brief(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 만들기. 프로젝트별 advisory lock 으로 개수 한도 계산이 겹치지 않게 한다
create or replace function public.create_production_brief(
  p_project_id             uuid,
  p_strategy_artifact_id   uuid,
  p_title                  text,
  p_target_audience        text,
  p_core_message           text,
  p_deliverable_types      text[],
  p_scope_summary          text,
  p_brand_tone_constraints text default null,
  p_reference_notes        text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  p    public.projects%rowtype;
  a    public.artifacts%rowtype;
  n    integer;
  b_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  -- 프로젝트 행을 FOR SHARE 로 잡는다: 만드는 동안 프로젝트 보관이 끼어들어 보관된 프로젝트에 새 브리프가 생기지 않게(Tester R-Q2).
  --   프로젝트를 고치는 쪽은 이 트랜잭션이 끝날 때까지 기다린다. 이 RPC 는 그 뒤 advisory lock 만 더 잡으므로 순서가 엇갈리지 않는다
  select x.* into p
    from public.projects x
   where x.id = p_project_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for share of x;
  if not found then
    raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  select x.* into a from public.artifacts x where x.id = p_strategy_artifact_id and x.project_id = p.id and x.type = 'strategy';
  if not found then
    raise exception 'NOT_FOUND: 이 프로젝트의 전략을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  perform app.assert_production_open(p.id, a.id);
  if a.approved_version_id is null then
    raise exception 'STRATEGY_NOT_APPROVED: 승인된 전략이 있어야 제작 브리프를 만들 수 있습니다' using errcode = 'P0001';
  end if;
  perform app.check_production_brief(p_title, p_target_audience, p_core_message, p_deliverable_types, p_scope_summary,
                                     p_brand_tone_constraints, p_reference_notes, 'drafting');
  perform pg_advisory_xact_lock(28001, hashtext(p.id::text)); -- 이름공간 28001(migration 28 제작 브리프) + 프로젝트(Tester R-Q1)
  select count(*) into n from public.production_briefs b where b.project_id = p.id and b.archived_at is null;
  if n >= 10 then
    raise exception 'LIMIT_REACHED: 한 프로젝트에는 제작 브리프를 10개까지 둘 수 있습니다. 쓰지 않는 것을 보관해 주세요' using errcode = 'P0001';
  end if;

  insert into public.production_briefs (workspace_id, project_id, strategy_artifact_id, strategy_version_id, title, target_audience,
                                        core_message, deliverable_types, scope_summary, brand_tone_constraints, reference_notes,
                                        source_snapshot, created_by)
  values (p.workspace_id, p.id, a.id, a.approved_version_id, app.funnel_trim(p_title), app.funnel_trim(p_target_audience),
          app.funnel_trim(p_core_message), p_deliverable_types, app.funnel_trim(p_scope_summary),
          app.brief_text(p_brand_tone_constraints, 1000, '브랜드 톤·금기 사항'), app.brief_text(p_reference_notes, 1000, '참고 자료 안내'),
          app.production_snapshot(a.approved_version_id), uid)
  returning id into b_id;
  perform app.production_brief_audit(p.workspace_id, b_id, 'production_brief_create', 1,
                                     jsonb_build_object('project_id', p.id, 'strategy_version_id', a.approved_version_id,
                                                        'deliverable_types', to_jsonb(p_deliverable_types)));
  return b_id;
end $$;
revoke execute on function public.create_production_brief(uuid, uuid, text, text, text, text[], text, text, text) from public, anon;
grant execute on function public.create_production_brief(uuid, uuid, text, text, text, text[], text, text, text) to authenticated;

-- 4-2) 수정(값 전체 교체). ready 에서도 고칠 수 있고 drafting 으로 돌릴 수도 있다(D6). 바뀐 것이 없으면 거절(감사 0)
create or replace function public.update_production_brief(
  p_brief_id               uuid,
  p_expected_revision      integer,
  p_title                  text,
  p_target_audience        text,
  p_core_message           text,
  p_deliverable_types      text[],
  p_scope_summary          text,
  p_brand_tone_constraints text,
  p_reference_notes        text,
  p_status                 text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b       public.production_briefs%rowtype;
  nv      public.production_briefs%rowtype;
  changed text[] := '{}'::text[];
  r       integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.lock_own_production_brief(p_brief_id);
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_production_open(b.project_id, b.strategy_artifact_id);
  perform app.check_production_brief(p_title, p_target_audience, p_core_message, p_deliverable_types, p_scope_summary,
                                     p_brand_tone_constraints, p_reference_notes, p_status);
  nv := b;
  nv.title := app.funnel_trim(p_title);
  nv.target_audience := app.funnel_trim(p_target_audience);
  nv.core_message := app.funnel_trim(p_core_message);
  nv.deliverable_types := p_deliverable_types;
  nv.scope_summary := app.funnel_trim(p_scope_summary);
  nv.brand_tone_constraints := app.brief_text(p_brand_tone_constraints, 1000, '브랜드 톤·금기 사항');
  nv.reference_notes := app.brief_text(p_reference_notes, 1000, '참고 자료 안내');
  nv.status := p_status;
  if nv.title is distinct from b.title then changed := array_append(changed, 'title'); end if;
  if nv.target_audience is distinct from b.target_audience then changed := array_append(changed, 'target_audience'); end if;
  if nv.core_message is distinct from b.core_message then changed := array_append(changed, 'core_message'); end if;
  if nv.deliverable_types is distinct from b.deliverable_types then changed := array_append(changed, 'deliverable_types'); end if;
  if nv.scope_summary is distinct from b.scope_summary then changed := array_append(changed, 'scope_summary'); end if;
  if nv.brand_tone_constraints is distinct from b.brand_tone_constraints then changed := array_append(changed, 'brand_tone_constraints'); end if;
  if nv.reference_notes is distinct from b.reference_notes then changed := array_append(changed, 'reference_notes'); end if;
  if nv.status is distinct from b.status then changed := array_append(changed, 'status'); end if;
  if cardinality(changed) = 0 then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  update public.production_briefs
     set title = nv.title, target_audience = nv.target_audience, core_message = nv.core_message,
         deliverable_types = nv.deliverable_types, scope_summary = nv.scope_summary,
         brand_tone_constraints = nv.brand_tone_constraints, reference_notes = nv.reference_notes, status = nv.status
   where id = b.id
   returning revision into r;
  -- 감사에는 바뀐 칸 이름과 상태만(본문 없음)
  perform app.production_brief_audit(b.workspace_id, b.id, 'production_brief_update', r,
                                     jsonb_build_object('changed', to_jsonb(changed), 'status_from', b.status, 'status_to', nv.status));
  return r;
end $$;
revoke execute on function public.update_production_brief(uuid, integer, text, text, text, text[], text, text, text, text) from public, anon;
grant execute on function public.update_production_brief(uuid, integer, text, text, text, text[], text, text, text, text) to authenticated;

-- 4-3) 다시 맞추기: 바탕 판과 사본을 지금 승인본으로(수동, DEC-P2-01-A)
create or replace function public.rebase_production_brief(p_brief_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b    public.production_briefs%rowtype;
  ap   uuid;
  snap jsonb;
  r    integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.lock_own_production_brief(p_brief_id);
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_production_open(b.project_id, b.strategy_artifact_id);
  select a.approved_version_id into ap from public.artifacts a where a.id = b.strategy_artifact_id;
  if ap is null then
    raise exception 'STRATEGY_NOT_APPROVED: 승인된 전략이 없습니다' using errcode = 'P0001';
  end if;
  if ap = b.strategy_version_id then
    raise exception 'VALIDATION: 이미 지금 승인된 전략 기준입니다' using errcode = '22023';
  end if;
  snap := app.production_snapshot(ap);
  update public.production_briefs set strategy_version_id = ap, source_snapshot = snap where id = b.id returning revision into r;
  perform app.production_brief_audit(b.workspace_id, b.id, 'production_brief_rebase', r,
                                     jsonb_build_object('from_version_id', b.strategy_version_id, 'to_version_id', ap,
                                                        'from_version', b.source_snapshot -> 'strategy_version', 'to_version', snap -> 'strategy_version'));
  return r;
end $$;
revoke execute on function public.rebase_production_brief(uuid, integer) from public, anon;
grant execute on function public.rebase_production_brief(uuid, integer) to authenticated;

-- 4-4) 보관(삭제 대신, 되돌리기 없음). 보관한 브리프는 읽기만 된다
create or replace function public.archive_production_brief(p_brief_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.production_briefs%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.lock_own_production_brief(p_brief_id);
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 제작 브리프입니다' using errcode = 'P0001';
  end if;
  perform app.assert_production_open(b.project_id, b.strategy_artifact_id);
  update public.production_briefs set archived_at = now() where id = b.id returning revision into r;
  perform app.production_brief_audit(b.workspace_id, b.id, 'production_brief_archive', r, jsonb_build_object('status', b.status));
  return r;
end $$;
revoke execute on function public.archive_production_brief(uuid, integer) from public, anon;
grant execute on function public.archive_production_brief(uuid, integer) to authenticated;
