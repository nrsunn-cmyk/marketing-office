-- P2-STRATEGY-IMPL-01 전략 1종(strategy) 후보: 프로필 승인 기록(C안), 근거 참조·출처 표(2표안), 직접 쓰기 차단(G4),
-- DB가 프로필 사본·근거 참조를 직접 만들고 확인하는 생성 RPC(G1·G2). 설계: Plan/Claude-Plan-Audit-20261116/P2-DB-DESIGN-01.md, DEC-P2-01.md
--
-- 바뀌는 것
--   1) 유형 CHECK 3곳(templates·tasks·artifacts)에 'strategy' 추가, 전략 템플릿 1행 추가.
--   2) company_profile_approvals: 프로필 버전 승인 기록(추가 전용). 직접 INSERT 정책 없음, 정의자 RPC로만 기록, 행위자 강제.
--   3) artifact_version_refs: 결과 버전이 근거로 쓴 프로필 버전·출처 자료·(나중) 다른 승인 버전. 추가 전용, RPC로만 기록,
--      같은 프로젝트·같은 고객인지 트리거로 한 번 더 확인(I1·I7).
--   4) research_sources: 프로젝트별 외부 출처(URL) 기록. 자동 수집 없음. RPC로만 추가·검토 상태 변경.
--   5) 전략(strategy) 유형의 결과물·버전·입력 사본은 로그인 역할이 직접 넣지 못한다(G4). P1(logo_brief·quote) 경로는 그대로.
--   6) 정의자 RPC: approve_company_profile_version, generate_strategy, save_strategy_manual_version,
--      add_research_source, set_research_source_review. 승인은 기존 decide_version(정의자)을 그대로 쓴다.
--
-- 바뀌지 않는 것: 기존 표·RPC 본문, P1 프로젝트 생성의 프로필 연결(project_profiles), TASK_TYPES(앱 계약).
-- 하지 않는 것: 퍼널·리드마그넷·브리프·채널 초안 유형(DEC-P2-01-A 결정 전), AI 생성, 점수.
--
-- 정의자 함수 규칙(S1·S2와 같음): search_path='' 고정·스키마 표기, 맨 앞 auth.uid() 확인,
--   소유 조건을 조회 WHERE 안에 넣어 남의 행은 잠그지 않음, 남의 것·없는 것은 같은 NOT_FOUND, public·anon 실행 권한 회수.

-- ─────────────────────────────────────────────
-- 1) 유형 확대와 템플릿
-- ─────────────────────────────────────────────
alter table public.templates drop constraint templates_type_check;
alter table public.templates add constraint templates_type_check check (type in ('logo_brief', 'quote', 'strategy'));
alter table public.tasks drop constraint tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in ('logo_brief', 'quote', 'strategy'));
alter table public.artifacts drop constraint artifacts_type_check;
alter table public.artifacts add constraint artifacts_type_check check (type in ('logo_brief', 'quote', 'strategy'));

insert into public.templates (type, version, key, body) values
  ('strategy', 1, 'strategy-template@1', '입력 조합형 채널 중립 전략 초안. 구현: src/domain/strategy/build.ts');

-- ─────────────────────────────────────────────
-- 2) 프로필 버전 승인 기록 (C안, 추가 전용)
-- ─────────────────────────────────────────────
create table public.company_profile_approvals (
  id                         uuid primary key default gen_random_uuid(),
  seq                        bigint generated always as identity unique,
  workspace_id               uuid not null,
  client_id                  uuid not null,
  company_profile_version_id uuid not null,
  actor_id                   uuid not null references auth.users (id),
  decision                   text not null check (decision in ('approved', 'revoked')),
  comment                    text check (comment is null or length(comment) <= 1000),
  created_at                 timestamptz not null default clock_timestamp(),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id),
  foreign key (client_id, company_profile_version_id) references public.company_profile_versions (client_id, id)
);

-- 해당 프로필 버전의 마지막 결정이 'approved'인가 (require_approval 과 같은 판정)
create or replace function app.profile_version_approved(p_version_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((
    select pa.decision = 'approved'
      from public.company_profile_approvals pa
     where pa.company_profile_version_id = p_version_id
     order by pa.seq desc
     limit 1
  ), false)
$$;
revoke execute on function app.profile_version_approved(uuid) from public, anon;
grant execute on function app.profile_version_approved(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 3) 근거 참조 (추가 전용)
-- ─────────────────────────────────────────────
create table public.artifact_version_refs (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  project_id                 uuid not null,
  from_version_id            uuid not null,
  ref_kind                   text not null check (ref_kind in ('company_profile_version', 'source_asset', 'artifact_version')),
  company_profile_version_id uuid references public.company_profile_versions (id),
  source_asset_id            uuid references public.source_assets (id),
  to_version_id              uuid,
  created_at                 timestamptz not null default now(),
  -- 종류마다 대상은 정확히 하나
  check (
    (ref_kind = 'company_profile_version' and company_profile_version_id is not null and source_asset_id is null and to_version_id is null) or
    (ref_kind = 'source_asset'            and source_asset_id is not null and company_profile_version_id is null and to_version_id is null) or
    (ref_kind = 'artifact_version'        and to_version_id is not null and company_profile_version_id is null and source_asset_id is null)
  ),
  foreign key (workspace_id, from_version_id) references public.artifact_versions (workspace_id, id),
  foreign key (workspace_id, to_version_id)   references public.artifact_versions (workspace_id, id),
  foreign key (workspace_id, project_id)      references public.projects (workspace_id, id)
);
create index artifact_version_refs_from on public.artifact_version_refs (from_version_id);

-- 같은 프로젝트·같은 고객만 참조할 수 있다(I1·I6·I7). RPC 안에서도 확인하지만 표 수준에서 한 번 더 막는다.
create or replace function app.check_version_ref() returns trigger
language plpgsql set search_path = '' as $$
declare
  from_project uuid;
  proj_client  uuid;
  ok           boolean;
begin
  select a.project_id into from_project
    from public.artifact_versions v join public.artifacts a on a.id = v.artifact_id
   where v.id = new.from_version_id;
  if from_project is distinct from new.project_id then
    raise exception 'REF_MISMATCH: 다른 프로젝트의 결과 버전입니다' using errcode = 'P0001';
  end if;
  select p.client_id into proj_client from public.projects p where p.id = new.project_id;

  if new.ref_kind = 'company_profile_version' then
    select exists (
      select 1 from public.company_profile_versions pv
       where pv.id = new.company_profile_version_id and pv.client_id = proj_client and pv.workspace_id = new.workspace_id
    ) into ok;
    if not ok then
      raise exception 'REF_MISMATCH: 이 프로젝트 고객의 프로필 버전이 아닙니다' using errcode = 'P0001';
    end if;
  elsif new.ref_kind = 'source_asset' then
    select exists (
      select 1 from public.source_assets s
       where s.id = new.source_asset_id and s.workspace_id = new.workspace_id and s.project_id = new.project_id
    ) into ok;
    if not ok then
      raise exception 'REF_MISMATCH: 다른 프로젝트의 자료입니다' using errcode = 'P0001';
    end if;
  else
    -- 다른 결과물의 승인본만 근거로 쓸 수 있다(하위 유형용. 지금은 쓰는 RPC가 없다)
    select exists (
      select 1 from public.artifact_versions v join public.artifacts a on a.id = v.artifact_id
       where v.id = new.to_version_id and a.project_id = new.project_id and a.approved_version_id = v.id
    ) into ok;
    if not ok then
      raise exception 'REF_MISMATCH: 같은 프로젝트의 승인본이 아닙니다' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.check_version_ref() from public, anon, authenticated;

create trigger artifact_version_refs_check before insert on public.artifact_version_refs
  for each row execute function app.check_version_ref();

-- ─────────────────────────────────────────────
-- 4) 출처 기록
-- ─────────────────────────────────────────────
create table public.research_sources (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  project_id     uuid not null,
  url            text not null check (url ~ '^https?://' and length(url) <= 2000),
  title          text not null check (length(trim(title)) between 1 and 300),
  publisher      text check (publisher is null or length(publisher) <= 200),
  retrieved_at   timestamptz not null,
  quoted_excerpt text check (quoted_excerpt is null or length(quoted_excerpt) <= 1000),
  review_status  text not null default 'unverified' check (review_status in ('unverified', 'verified')),
  created_by     uuid not null references auth.users (id),
  revision       integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id)
);
create trigger research_sources_guard before update on public.research_sources
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'url', 'retrieved_at', 'created_by', 'created_at');

-- ─────────────────────────────────────────────
-- RLS·불변·행위자 (새 표 3개)
--   select 만 본인 업무실. insert·update·delete 정책 없음 → 정의자 RPC로만 쓴다.
-- ─────────────────────────────────────────────
alter table public.company_profile_approvals enable row level security;
alter table public.artifact_version_refs     enable row level security;
alter table public.research_sources          enable row level security;
create policy company_profile_approvals_select on public.company_profile_approvals for select to authenticated using (app.owns_workspace(workspace_id));
create policy artifact_version_refs_select     on public.artifact_version_refs     for select to authenticated using (app.owns_workspace(workspace_id));
create policy research_sources_select          on public.research_sources          for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.company_profile_approvals, public.artifact_version_refs, public.research_sources from anon;

create trigger company_profile_approvals_immutable before update or delete on public.company_profile_approvals
  for each row execute function app.reject_mutation();
create trigger artifact_version_refs_immutable before update or delete on public.artifact_version_refs
  for each row execute function app.reject_mutation();
create trigger company_profile_approvals_actor before insert on public.company_profile_approvals
  for each row execute function app.enforce_actor();

-- ─────────────────────────────────────────────
-- 5) 전략 유형 직접 쓰기 차단 (G4)
--   로그인 역할(authenticated)·비로그인(anon)으로 직접 넣으면 거절한다. 정의자 RPC 안(함수 소유자 권한)과
--   관리 역할은 통과한다. P1 유형은 검사하지 않는다(기존 invoker RPC 흐름 보존).
-- ─────────────────────────────────────────────
create or replace function app.reject_direct_strategy_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  t text;
begin
  if tg_table_name = 'artifacts' then
    t := new.type;
  elsif tg_table_name = 'artifact_versions' then
    select a.type into t from public.artifacts a where a.id = new.artifact_id;
  else -- task_input_snapshots
    select k.type into t from public.tasks k where k.id = new.task_id;
  end if;
  if t = 'strategy' and current_user in ('authenticated', 'anon') then
    raise exception 'DIRECT_WRITE_FORBIDDEN: 전략 자료는 정해진 기능(RPC)으로만 저장할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function app.reject_direct_strategy_write() from public, anon, authenticated;

create trigger artifacts_strategy_direct            before insert on public.artifacts            for each row execute function app.reject_direct_strategy_write();
create trigger artifact_versions_strategy_direct    before insert on public.artifact_versions    for each row execute function app.reject_direct_strategy_write();
create trigger task_input_snapshots_strategy_direct before insert on public.task_input_snapshots for each row execute function app.reject_direct_strategy_write();

-- ─────────────────────────────────────────────
-- 6-1) 프로필 버전 승인·철회
-- ─────────────────────────────────────────────
create or replace function public.approve_company_profile_version(
  p_profile_version_id uuid,
  p_decision           text default 'approved',
  p_comment            text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pv  public.company_profile_versions%rowtype;
  s   bigint;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into pv
    from public.company_profile_versions x
   where x.id = p_profile_version_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid);
  if not found then
    raise exception 'NOT_FOUND: 프로필을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_decision not in ('approved', 'revoked') then
    raise exception 'VALIDATION: 알 수 없는 결정입니다' using errcode = '22023';
  end if;

  insert into public.company_profile_approvals (workspace_id, client_id, company_profile_version_id, actor_id, decision, comment)
  values (pv.workspace_id, pv.client_id, pv.id, uid, p_decision, nullif(trim(p_comment), ''))
  returning seq into s;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (pv.workspace_id, 'company_profile_version', pv.id, uid, 'profile_' || p_decision,
          jsonb_build_object('client_id', pv.client_id, 'version', pv.version));
  return s;
end $$;
revoke execute on function public.approve_company_profile_version(uuid, text, text) from public, anon;
grant execute on function public.approve_company_profile_version(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────
-- 6-2) 전략 생성 (template). 프로필 사본·근거 참조·입력 해시는 DB가 직접 만든다(G1·G2·G5).
--   p_extra_inputs: 계약 strategyInputSchema 를 통과한 입력, p_content: buildStrategyDraft 결과.
--   DB가 보장하는 것: 작업 소유·유형, 고객 프로젝트, 프로필이 그 고객의 승인된 버전, 입력·결과의 프로필·프로젝트가 같음,
--   자료 출처가 같은 프로젝트, 같은 키 재요청 처리. 내용 문장 자체는 앱의 순수 함수가 만든다.
-- ─────────────────────────────────────────────
create or replace function public.generate_strategy(
  p_task_id            uuid,
  p_idempotency_key    text,
  p_profile_version_id uuid,
  p_extra_inputs       jsonb,
  p_content            jsonb
) returns table (artifact_id uuid, version_id uuid, version integer, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  uid      uuid := auth.uid();
  t        public.tasks%rowtype;
  p        public.projects%rowtype;
  pv       public.company_profile_versions%rowtype;
  c        public.clients%rowtype;
  existing public.generation_runs%rowtype;
  h        text;
  src      jsonb;
  asset_ids uuid[];
  snap     jsonb;
  refs     jsonb;
  snap_id  uuid;
  run_id   uuid;
  a_id     uuid;
  v_id     uuid;
  v_no     integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into t
    from public.tasks x
   where x.id = p_task_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 작업을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if t.type <> 'strategy' then
    raise exception 'VALIDATION: 전략 작업이 아닙니다' using errcode = '22023';
  end if;
  if t.status = 'cancelled' then
    raise exception 'INVALID_TRANSITION: 취소된 작업입니다' using errcode = 'P0001';
  end if;
  if p_extra_inputs is null or jsonb_typeof(p_extra_inputs) <> 'object'
     or p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'VALIDATION: 입력·결과 형식이 올바르지 않습니다' using errcode = '22023';
  end if;

  -- 같은 키 재요청: DB가 계산한 해시가 같으면 기존 결과, 다르면 충돌
  h := encode(sha256(convert_to(p_profile_version_id::text || '|' || p_extra_inputs::text || '|' || p_content::text, 'UTF8')), 'hex');
  select * into existing from public.generation_runs g
   where g.task_id = t.id and g.action = 'generate' and g.idempotency_key = p_idempotency_key;
  if found then
    if existing.input_hash <> h then
      raise exception 'IDEMPOTENCY_MISMATCH: 같은 요청 키로 다른 내용이 들어왔습니다' using errcode = 'P0001';
    end if;
    return query
      select av.artifact_id, av.id, av.version, true
        from public.artifact_versions av where av.id = existing.artifact_version_id;
    return;
  end if;

  select * into p from public.projects where id = t.project_id;
  if p.client_id is null then
    raise exception 'PROFILE_REQUIRED: 전략은 지금 고객 프로젝트만 지원합니다' using errcode = '22023';
  end if;
  select * into pv from public.company_profile_versions
   where id = p_profile_version_id and client_id = p.client_id and workspace_id = t.workspace_id;
  if not found then
    raise exception 'PROFILE_MISMATCH: 이 프로젝트 고객의 프로필 버전이 아닙니다' using errcode = 'P0001';
  end if;
  if not app.profile_version_approved(pv.id) then
    raise exception 'PROFILE_NOT_APPROVED: 승인된 프로필 버전만 쓸 수 있습니다' using errcode = 'P0001';
  end if;

  -- 앱이 보낸 입력·결과의 프로젝트·프로필 참조가 DB의 실제 값과 같은지(G2)
  if p_extra_inputs ->> 'projectId' is distinct from p.id::text
     or p_extra_inputs #>> '{profile,id}' is distinct from pv.id::text
     or p_extra_inputs #>> '{profile,version}' is distinct from pv.version::text
     or p_extra_inputs #>> '{profile,projectId}' is distinct from p.id::text
     or p_extra_inputs #>> '{profile,clientId}' is distinct from p.client_id::text
     or p_content ->> 'projectId' is distinct from p.id::text
     or p_content #>> '{profileRef,id}' is distinct from pv.id::text
     or p_content #>> '{profileRef,version}' is distinct from pv.version::text then
    raise exception 'CONTENT_MISMATCH: 입력·결과의 프로젝트나 프로필이 실제 연결과 다릅니다' using errcode = 'P0001';
  end if;

  -- 출처: 프로필 출처는 이 프로필 버전만, 자료 출처는 같은 프로젝트의 자료만(I7)
  asset_ids := '{}';
  for src in select s from jsonb_path_query(p_extra_inputs, '$.sections.*.facts[*].sources[*]') s loop
    if src ->> 'kind' = 'profile' then
      if src ->> 'profileId' is distinct from pv.id::text or src ->> 'version' is distinct from pv.version::text then
        raise exception 'SOURCE_MISMATCH: 참조한 프로필 버전과 다른 프로필 출처입니다' using errcode = 'P0001';
      end if;
    elsif src ->> 'kind' = 'asset' then
      if not exists (
        select 1 from public.source_assets s
         where s.id::text = src ->> 'assetId' and s.workspace_id = t.workspace_id and s.project_id = p.id
      ) then
        raise exception 'SOURCE_MISMATCH: 이 프로젝트의 자료가 아닙니다' using errcode = 'P0001';
      end if;
      asset_ids := asset_ids || (src ->> 'assetId')::uuid;
    end if;
  end loop;
  select coalesce(array_agg(distinct x order by x), '{}') into asset_ids from unnest(asset_ids) x;

  -- 프로필 사본·근거 참조 목록은 DB가 직접 만든다(G1·G2)
  select * into c from public.clients where id = p.client_id;
  snap := jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'title', p.title, 'kind', p.kind),
    'client',  jsonb_build_object('id', c.id, 'name', c.name, 'industry', c.industry, 'description', c.description),
    'profile', jsonb_build_object('id', pv.id, 'version', pv.version, 'products', pv.products, 'audience', pv.audience,
                                  'strengths', to_jsonb(pv.strengths), 'brand_rules', pv.brand_rules,
                                  'channel_urls', to_jsonb(pv.channel_urls))
  );
  refs := jsonb_build_array(jsonb_build_object('type', 'company_profile_version', 'id', pv.id, 'version', pv.version))
       || coalesce((select jsonb_agg(jsonb_build_object('type', 'source_asset', 'id', x)) from unnest(asset_ids) x), '[]'::jsonb);

  insert into public.task_input_snapshots (workspace_id, task_id, profile_snapshot, extra_inputs, source_version_refs, input_hash)
  values (t.workspace_id, t.id, snap, p_extra_inputs, refs, h)
  returning id into snap_id;

  insert into public.generation_runs (workspace_id, task_id, action, idempotency_key, input_hash, status, mode, started_at)
  values (t.workspace_id, t.id, 'generate', p_idempotency_key, h, 'running', 'template', now())
  returning id into run_id;

  select a.id into a_id from public.artifacts a where a.task_id = t.id for update;
  if not found then
    insert into public.artifacts (workspace_id, project_id, task_id, type)
    values (t.workspace_id, t.project_id, t.id, t.type)
    returning id into a_id;
  end if;

  select coalesce(max(av.version), 0) + 1 into v_no from public.artifact_versions av where av.artifact_id = a_id;
  insert into public.artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator, template_id, created_by)
  values (t.workspace_id, a_id, v_no, p_content, snap_id, 'template', t.template_id, uid)
  returning id into v_id;

  insert into public.artifact_version_refs (workspace_id, project_id, from_version_id, ref_kind, company_profile_version_id)
  values (t.workspace_id, p.id, v_id, 'company_profile_version', pv.id);
  insert into public.artifact_version_refs (workspace_id, project_id, from_version_id, ref_kind, source_asset_id)
  select t.workspace_id, p.id, v_id, 'source_asset', x from unnest(asset_ids) x;

  update public.artifacts set current_draft_version_id = v_id where id = a_id;
  update public.generation_runs set status = 'succeeded', finished_at = now(), artifact_version_id = v_id where id = run_id;
  if t.status <> 'completed' then
    perform app.move_task(t.id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (t.workspace_id, 'artifact', a_id, uid, 'generate', v_no,
          jsonb_build_object('mode', 'template', 'version_id', v_id, 'profile_version_id', pv.id));

  return query select a_id, v_id, v_no, false;
end $$;
revoke execute on function public.generate_strategy(uuid, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.generate_strategy(uuid, text, uuid, jsonb, jsonb) to authenticated;

-- ─────────────────────────────────────────────
-- 6-3) 전략 직접 고치기: 새 초안 버전. 근거 참조는 바탕 버전 것을 그대로 잇는다.
--   결과의 프로젝트·프로필 참조는 바꿀 수 없다(바꾸려면 새로 생성). 상태 규칙은 S3 과 같다.
-- ─────────────────────────────────────────────
create or replace function public.save_strategy_manual_version(
  p_artifact_id       uuid,
  p_expected_revision integer,
  p_content           jsonb
) returns table (version_id uuid, version integer)
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  a    public.artifacts%rowtype;
  base public.artifact_versions%rowtype;
  st   text;
  v_id uuid;
  v_no integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into a
    from public.artifacts x
   where x.id = p_artifact_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.type <> 'strategy' then
    raise exception 'VALIDATION: 전략 결과물이 아닙니다' using errcode = '22023';
  end if;
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  select * into base from public.artifact_versions where id = a.current_draft_version_id;
  if not found then
    raise exception 'NOT_FOUND: 고칠 초안이 없습니다' using errcode = 'P0002';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or p_content ->> 'projectId' is distinct from base.content ->> 'projectId'
     or p_content -> 'profileRef' is distinct from base.content -> 'profileRef' then
    raise exception 'CONTENT_MISMATCH: 프로젝트·프로필 참조는 바꿀 수 없습니다. 새로 만들어 주세요' using errcode = 'P0001';
  end if;

  select coalesce(max(av.version), 0) + 1 into v_no from public.artifact_versions av where av.artifact_id = a.id;
  insert into public.artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator, template_id, created_by)
  values (a.workspace_id, a.id, v_no, p_content, base.input_snapshot_id, 'manual', base.template_id, uid)
  returning id into v_id;

  insert into public.artifact_version_refs (workspace_id, project_id, from_version_id, ref_kind, company_profile_version_id, source_asset_id, to_version_id)
  select r.workspace_id, r.project_id, v_id, r.ref_kind, r.company_profile_version_id, r.source_asset_id, r.to_version_id
    from public.artifact_version_refs r where r.from_version_id = base.id;

  update public.artifacts set current_draft_version_id = v_id where id = a.id;
  select k.status into st from public.tasks k where k.id = a.task_id for update;
  if st <> 'completed' then
    perform app.move_task(a.task_id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (a.workspace_id, 'artifact', a.id, uid, 'edit', v_no, jsonb_build_object('version_id', v_id));
  return query select v_id, v_no;
end $$;
revoke execute on function public.save_strategy_manual_version(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_strategy_manual_version(uuid, integer, jsonb) to authenticated;

-- ─────────────────────────────────────────────
-- 6-4) 출처 추가·검토 상태
-- ─────────────────────────────────────────────
create or replace function public.add_research_source(
  p_project_id     uuid,
  p_url            text,
  p_title          text,
  p_retrieved_at   timestamptz,
  p_publisher      text default null,
  p_quoted_excerpt text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  p    public.projects%rowtype;
  s_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into p
    from public.projects x
   where x.id = p_project_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid);
  if not found then
    raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  insert into public.research_sources (workspace_id, project_id, url, title, publisher, retrieved_at, quoted_excerpt, created_by)
  values (p.workspace_id, p.id, p_url, trim(p_title), nullif(trim(p_publisher), ''), p_retrieved_at, nullif(p_quoted_excerpt, ''), uid)
  returning id into s_id;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (p.workspace_id, 'research_source', s_id, uid, 'add', jsonb_build_object('project_id', p.id));
  return s_id;
end $$;
revoke execute on function public.add_research_source(uuid, text, text, timestamptz, text, text) from public, anon;
grant execute on function public.add_research_source(uuid, text, text, timestamptz, text, text) to authenticated;

create or replace function public.set_research_source_review(
  p_source_id         uuid,
  p_status            text,
  p_expected_revision integer
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s   public.research_sources%rowtype;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into s
    from public.research_sources x
   where x.id = p_source_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 출처를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_status not in ('unverified', 'verified') then
    raise exception 'VALIDATION: 알 수 없는 검토 상태입니다' using errcode = '22023';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  update public.research_sources set review_status = p_status where id = s.id returning revision into r;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (s.workspace_id, 'research_source', s.id, uid, 'review', jsonb_build_object('status', p_status));
  return r;
end $$;
revoke execute on function public.set_research_source_review(uuid, text, integer) from public, anon;
grant execute on function public.set_research_source_review(uuid, text, integer) to authenticated;
