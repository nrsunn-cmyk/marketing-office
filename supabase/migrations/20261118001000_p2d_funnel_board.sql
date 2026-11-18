-- P2D-BACKEND-01 마케팅 퍼널 보드(P2-d) 서버. 설계: Plan/Claude-Backend-20261118/P2D-BACKEND-01-DESIGN.md
--
-- 바뀌는 것
--   1) funnels: 전략 결과물당 퍼널 1개. 참조 전략 버전은 만들 때·다시 맞출 때 그 전략의 승인본만(I6).
--   2) funnel_stages: 퍼널당 5단계(유입·인지·고려·전환·유지). 퍼널과 함께 생성, 타깃 문구만 고친다.
--   3) funnel_items: 단계별 카드(콘텐츠·리드마그넷·전환 오퍼). 수정·이동·보관. 삭제 없음.
--   4) 세 표 모두 select 만 본인 업무실. 직접 쓰기 정책 없음 + INSERT·UPDATE·DELETE·TRUNCATE 회수.
--      쓰기는 정의자 RPC 6개만(create_funnel, rebase_funnel, update_funnel_stage,
--      add_funnel_item, update_funnel_item, archive_funnel_item). RPC마다 감사 기록 1행.
--
-- R1 보완(QA-P2D-BACKEND-01)
--   - 글 입력의 앞뒤 공백류(줄바꿈·탭 포함)는 app.funnel_trim 으로 지우고, 비면 null(설명 포함, W2).
--   - 보관한 프로젝트의 퍼널은 읽기 전용(생성·편집 거절). 프로젝트를 다시 열면 고칠 수 있다(O3).
--   - 보관한 카드는 단계 한도(활성 50)에 넣지 않는다(O1). 삭제·보관 취소가 없어서, 보관까지 세면 한도에 닿은 단계는
--     영원히 카드를 더 넣을 수 없게 된다. 누적은 본인 업무실 안의 일이고, 보드는 활성 카드 부분 색인으로 읽는다.
-- 바뀌지 않는 것: 기존 표·RPC, 유형 CHECK(logo_brief·quote·strategy), 전략 승인 흐름(decide_version).
-- 결정하지 않는 것: DEC-P2-01-A(하위 결과물 승인 처리 — 퍼널에는 승인 흐름이 없다),
--   N2(기준 프로필 철회 시 정책 — 퍼널 RPC는 프로필 승인 상태를 보지 않는다).
--
-- 정의자 함수 규칙(S1·S2·P2-c와 같음): search_path='' 고정·스키마 표기, 맨 앞 auth.uid() 확인,
--   소유 조건을 조회 WHERE 안에 넣어 남의 행은 잠그지 않음, 남의 것·없는 것은 같은 NOT_FOUND, public·anon 실행 권한 회수.

-- ─────────────────────────────────────────────
-- 0) 카드 값 규칙 (표 CHECK 와 RPC 가 함께 쓴다)
-- ─────────────────────────────────────────────
-- 앞뒤 공백류(공백·탭·줄바꿈 등)를 지운다. 앱 계약(zod trim)과 같게 맞춘다(R1 W2: btrim 은 공백만 지운다)
create or replace function app.funnel_trim(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p, '^[[:space:]]+|[[:space:]]+$', '', 'g')
$$;
revoke execute on function app.funnel_trim(text) from public, anon;

-- 리드마그넷 상세: null 또는 {deliverable?, leadFields?, outline?} 만 있는 객체.
--   deliverable 200자 이하, leadFields 10개 이하(각 1~50자), outline 20개 이하(각 1~300자). 다른 유형은 null 만.
create or replace function app.funnel_details_ok(p_kind text, p_details jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_details is null then true
    when p_kind is distinct from 'lead_magnet' then false
    when jsonb_typeof(p_details) <> 'object' then false
    when exists (select 1 from jsonb_object_keys(p_details) k where k not in ('deliverable', 'leadFields', 'outline')) then false
    when p_details ? 'deliverable' and (jsonb_typeof(p_details -> 'deliverable') <> 'string' or length(p_details ->> 'deliverable') > 200) then false
    when p_details ? 'leadFields' and (
           jsonb_typeof(p_details -> 'leadFields') <> 'array'
        or jsonb_array_length(p_details -> 'leadFields') > 10
        or exists (select 1 from jsonb_array_elements(p_details -> 'leadFields') e
                    where jsonb_typeof(e) <> 'string' or length(app.funnel_trim(e #>> '{}')) not between 1 and 50)) then false
    when p_details ? 'outline' and (
           jsonb_typeof(p_details -> 'outline') <> 'array'
        or jsonb_array_length(p_details -> 'outline') > 20
        or exists (select 1 from jsonb_array_elements(p_details -> 'outline') e
                    where jsonb_typeof(e) <> 'string' or length(app.funnel_trim(e #>> '{}')) not between 1 and 300)) then false
    else true
  end
$$;
revoke execute on function app.funnel_details_ok(text, jsonb) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
create table public.funnels (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null,
  project_id           uuid not null,
  strategy_artifact_id uuid not null unique,
  strategy_version_id  uuid not null,
  revision             integer not null default 1,
  created_by           uuid not null references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (workspace_id, strategy_artifact_id) references public.artifacts (workspace_id, id),
  -- 참조 버전은 그 전략 결과물의 버전만
  foreign key (strategy_artifact_id, strategy_version_id) references public.artifact_versions (artifact_id, id),
  unique (workspace_id, id)
);

create table public.funnel_stages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  funnel_id    uuid not null,
  stage_key    text not null check (stage_key in ('inflow', 'awareness', 'consideration', 'conversion', 'retention')),
  position     integer not null,
  focus        text check (focus is null or length(app.funnel_trim(focus)) between 1 and 300),
  revision     integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (position = case stage_key when 'inflow' then 1 when 'awareness' then 2 when 'consideration' then 3
                                    when 'conversion' then 4 else 5 end),
  foreign key (workspace_id, funnel_id) references public.funnels (workspace_id, id),
  unique (funnel_id, stage_key),
  unique (funnel_id, position),
  unique (funnel_id, id)
);

create table public.funnel_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  funnel_id    uuid not null,
  stage_id     uuid not null,
  kind         text not null check (kind in ('content', 'lead_magnet', 'cta')),
  title        text not null check (length(app.funnel_trim(title)) between 1 and 200),
  description  text check (description is null or (length(description) <= 2000 and app.funnel_trim(description) <> '')),
  channel      text check (channel is null or length(app.funnel_trim(channel)) between 1 and 100),
  status       text not null default 'planned' check (status in ('planned', 'drafting', 'reviewed', 'published')),
  target_note  text check (target_note is null or length(app.funnel_trim(target_note)) between 1 and 200),
  details      jsonb check (app.funnel_details_ok(kind, details)),
  position     integer not null check (position > 0),
  archived_at  timestamptz,
  revision     integer not null default 1,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (workspace_id, funnel_id) references public.funnels (workspace_id, id),
  -- 다른 퍼널의 단계로는 옮길 수 없다
  foreign key (funnel_id, stage_id) references public.funnel_stages (funnel_id, id)
);
create index funnel_items_stage on public.funnel_items (stage_id, position);
-- 보드는 보관하지 않은 카드만 읽는다(보관 카드는 한도 없이 쌓일 수 있어 따로 둔다, R1 O1)
create index funnel_items_active on public.funnel_items (funnel_id, stage_id, position) where archived_at is null;
create index funnels_project on public.funnels (project_id);

create trigger funnels_guard before update on public.funnels
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'strategy_artifact_id', 'created_by', 'created_at');
create trigger funnel_stages_guard before update on public.funnel_stages
  for each row execute function app.guard_update('id', 'workspace_id', 'funnel_id', 'stage_key', 'position', 'created_at');
create trigger funnel_items_guard before update on public.funnel_items
  for each row execute function app.guard_update('id', 'workspace_id', 'funnel_id', 'created_by', 'created_at');
-- 행위자(created_by)는 정의자 RPC가 auth.uid() 로 넣는다. 로그인 역할은 직접 INSERT 권한이 없다(아래 2절).

-- ─────────────────────────────────────────────
-- 2) RLS·권한: select 만 본인 업무실, 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.funnels       enable row level security;
alter table public.funnel_stages enable row level security;
alter table public.funnel_items  enable row level security;
create policy funnels_select       on public.funnels       for select to authenticated using (app.owns_workspace(workspace_id));
create policy funnel_stages_select on public.funnel_stages for select to authenticated using (app.owns_workspace(workspace_id));
create policy funnel_items_select  on public.funnel_items  for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.funnels, public.funnel_stages, public.funnel_items from anon;
revoke insert, update, delete, truncate on public.funnels, public.funnel_stages, public.funnel_items from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미 (정의자 RPC 안에서만 부른다)
-- ─────────────────────────────────────────────
-- 퍼널을 고칠 수 있는지: 전략 작업이 취소되지 않았고, 프로젝트가 보관 상태가 아니어야 한다.
--   보관한 프로젝트의 퍼널은 읽기 전용이다(R1 O3). 프로젝트를 다시 열면(archived → active) 다시 고칠 수 있다.
create or replace function app.assert_funnel_open(p_funnel_id uuid) returns void
language plpgsql stable set search_path = '' as $$
declare
  st text;
  ps text;
begin
  select k.status, p.status into st, ps
    from public.funnels f
    join public.artifacts a on a.id = f.strategy_artifact_id
    join public.tasks k on k.id = a.task_id
    join public.projects p on p.id = f.project_id
   where f.id = p_funnel_id;
  if st = 'cancelled' then
    raise exception 'INVALID_TRANSITION: 취소된 작업의 퍼널은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  if ps = 'archived' then
    raise exception 'INVALID_TRANSITION: 보관한 프로젝트의 퍼널은 고칠 수 없습니다. 프로젝트를 다시 열어 주세요' using errcode = 'P0001';
  end if;
end $$;
revoke execute on function app.assert_funnel_open(uuid) from public, anon, authenticated;

-- 카드 값 검사(문구를 구체적으로 돌려주려고 CHECK 앞에서 한 번 더 본다)
create or replace function app.check_funnel_item(
  p_kind text, p_title text, p_description text, p_channel text, p_status text, p_target_note text, p_details jsonb
) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('content', 'lead_magnet', 'cta') then
    raise exception 'VALIDATION: 알 수 없는 카드 유형입니다' using errcode = '22023';
  end if;
  if coalesce(length(app.funnel_trim(p_title)), 0) not between 1 and 200 then
    raise exception 'VALIDATION: 제목은 1~200자여야 합니다' using errcode = '22023';
  end if;
  if p_description is not null and length(p_description) > 2000 then
    raise exception 'VALIDATION: 설명은 2000자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_channel is not null and length(app.funnel_trim(p_channel)) > 100 then
    raise exception 'VALIDATION: 채널은 100자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('planned', 'drafting', 'reviewed', 'published') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
  if p_target_note is not null and length(app.funnel_trim(p_target_note)) > 200 then
    raise exception 'VALIDATION: 목표 메모는 200자 이하여야 합니다' using errcode = '22023';
  end if;
  if not app.funnel_details_ok(p_kind, p_details) then
    raise exception 'VALIDATION: 리드마그넷 기획 내용 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
end $$;
revoke execute on function app.check_funnel_item(text, text, text, text, text, text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 퍼널 만들기: 전략 승인본을 참조하는 퍼널 1개 + 단계 5개. 이미 있으면 그대로 돌려준다.
create or replace function public.create_funnel(p_strategy_artifact_id uuid)
returns table (funnel_id uuid, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  a    public.artifacts%rowtype;
  st   text;
  f_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  -- 같은 전략에 동시에 두 번 만들지 않도록 결과물 행을 잠근다(본인 것만)
  select x.* into a
    from public.artifacts x
   where x.id = p_strategy_artifact_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 전략을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.type <> 'strategy' then
    raise exception 'VALIDATION: 전략 결과물이 아닙니다' using errcode = '22023';
  end if;

  select f.id into f_id from public.funnels f where f.strategy_artifact_id = a.id;
  if found then
    return query select f_id, true;
    return;
  end if;

  select k.status into st from public.tasks k where k.id = a.task_id;
  if st = 'cancelled' then
    raise exception 'INVALID_TRANSITION: 취소된 작업입니다' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.projects p where p.id = a.project_id and p.status = 'archived') then
    raise exception 'INVALID_TRANSITION: 보관한 프로젝트에는 퍼널을 만들 수 없습니다. 프로젝트를 다시 열어 주세요' using errcode = 'P0001';
  end if;
  -- I6: 승인된 전략 버전만 참조한다. 프로필 승인 상태는 보지 않는다(N2 미결)
  if a.approved_version_id is null then
    raise exception 'STRATEGY_NOT_APPROVED: 승인된 전략이 있어야 퍼널을 만들 수 있습니다' using errcode = 'P0001';
  end if;

  insert into public.funnels (workspace_id, project_id, strategy_artifact_id, strategy_version_id, created_by)
  values (a.workspace_id, a.project_id, a.id, a.approved_version_id, uid)
  returning id into f_id;
  insert into public.funnel_stages (workspace_id, funnel_id, stage_key, position)
  select a.workspace_id, f_id, s.k, s.p
    from (values ('inflow', 1), ('awareness', 2), ('consideration', 3), ('conversion', 4), ('retention', 5)) s(k, p);

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (a.workspace_id, 'funnel', f_id, uid, 'funnel_create',
          jsonb_build_object('strategy_artifact_id', a.id, 'strategy_version_id', a.approved_version_id));
  return query select f_id, false;
end $$;
revoke execute on function public.create_funnel(uuid) from public, anon;
grant execute on function public.create_funnel(uuid) to authenticated;

-- 4-2) 다시 맞추기: 참조 전략 버전을 지금 승인본으로. 주인님이 누를 때만(자동 없음)
create or replace function public.rebase_funnel(p_funnel_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  f   public.funnels%rowtype;
  ap  uuid;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into f
    from public.funnels x
   where x.id = p_funnel_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 퍼널을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if f.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(f.id);
  select a.approved_version_id into ap from public.artifacts a where a.id = f.strategy_artifact_id;
  if ap is null then
    raise exception 'STRATEGY_NOT_APPROVED: 승인된 전략이 없습니다' using errcode = 'P0001';
  end if;
  if ap = f.strategy_version_id then
    raise exception 'VALIDATION: 이미 지금 승인된 전략 기준입니다' using errcode = '22023';
  end if;
  update public.funnels set strategy_version_id = ap where id = f.id returning revision into r;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (f.workspace_id, 'funnel', f.id, uid, 'funnel_rebase', r,
          jsonb_build_object('from_version_id', f.strategy_version_id, 'to_version_id', ap));
  return r;
end $$;
revoke execute on function public.rebase_funnel(uuid, integer) from public, anon;
grant execute on function public.rebase_funnel(uuid, integer) to authenticated;

-- 4-3) 단계 타깃 문구
create or replace function public.update_funnel_stage(p_stage_id uuid, p_expected_revision integer, p_focus text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s   public.funnel_stages%rowtype;
  v   text := nullif(app.funnel_trim(p_focus), '');
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into s
    from public.funnel_stages x
   where x.id = p_stage_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 퍼널 단계를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(s.funnel_id);
  if v is not null and length(v) > 300 then
    raise exception 'VALIDATION: 단계 타깃 문구는 300자 이하여야 합니다' using errcode = '22023';
  end if;
  update public.funnel_stages set focus = v where id = s.id returning revision into r;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (s.workspace_id, 'funnel', s.funnel_id, uid, 'stage_update', r, jsonb_build_object('stage_key', s.stage_key));
  return r;
end $$;
revoke execute on function public.update_funnel_stage(uuid, integer, text) from public, anon;
grant execute on function public.update_funnel_stage(uuid, integer, text) to authenticated;

-- 4-4) 카드 추가(단계 맨 끝). 단계 행을 잠가 순서·개수 계산이 겹치지 않게 한다
create or replace function public.add_funnel_item(
  p_stage_id    uuid,
  p_kind        text,
  p_title       text,
  p_description text default null,
  p_channel     text default null,
  p_status      text default 'planned',
  p_target_note text default null,
  p_details     jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  s    public.funnel_stages%rowtype;
  n    integer;
  pos  integer;
  i_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into s
    from public.funnel_stages x
   where x.id = p_stage_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 퍼널 단계를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  perform app.assert_funnel_open(s.funnel_id);
  perform app.check_funnel_item(p_kind, p_title, p_description, nullif(app.funnel_trim(p_channel), ''), p_status, nullif(app.funnel_trim(p_target_note), ''), p_details);
  select count(*) filter (where i.archived_at is null), coalesce(max(i.position), 0) + 1 into n, pos
    from public.funnel_items i where i.stage_id = s.id;
  if n >= 50 then
    raise exception 'VALIDATION: 한 단계에는 카드를 50개까지 둘 수 있습니다' using errcode = '22023';
  end if;
  insert into public.funnel_items (workspace_id, funnel_id, stage_id, kind, title, description, channel, status, target_note, details, position, created_by)
  values (s.workspace_id, s.funnel_id, s.id, p_kind, app.funnel_trim(p_title), nullif(app.funnel_trim(p_description), ''), nullif(app.funnel_trim(p_channel), ''),
          p_status, nullif(app.funnel_trim(p_target_note), ''), p_details, pos, uid)
  returning id into i_id;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (s.workspace_id, 'funnel_item', i_id, uid, 'item_add', 1,
          jsonb_build_object('funnel_id', s.funnel_id, 'stage_key', s.stage_key, 'kind', p_kind));
  return i_id;
end $$;
revoke execute on function public.add_funnel_item(uuid, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.add_funnel_item(uuid, text, text, text, text, text, text, jsonb) to authenticated;

-- 4-5) 카드 수정(값 전체 교체). 단계가 바뀌면 같은 퍼널의 그 단계 맨 끝으로 옮긴다
create or replace function public.update_funnel_item(
  p_item_id           uuid,
  p_expected_revision integer,
  p_stage_id          uuid,
  p_kind              text,
  p_title             text,
  p_description       text,
  p_channel           text,
  p_status            text,
  p_target_note       text,
  p_details           jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  it  public.funnel_items%rowtype;
  s   public.funnel_stages%rowtype;
  n   integer;
  pos integer;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into it
    from public.funnel_items x
   where x.id = p_item_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 카드를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if it.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if it.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 카드는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(it.funnel_id);
  perform app.check_funnel_item(p_kind, p_title, p_description, nullif(app.funnel_trim(p_channel), ''), p_status, nullif(app.funnel_trim(p_target_note), ''), p_details);

  pos := it.position;
  if p_stage_id is distinct from it.stage_id then
    -- 같은 퍼널의 단계만. 다른 퍼널·남의 단계는 구분하지 않고 같은 문구
    select x.* into s from public.funnel_stages x where x.id = p_stage_id and x.funnel_id = it.funnel_id for update of x;
    if not found then
      raise exception 'VALIDATION: 같은 퍼널의 단계로만 옮길 수 있습니다' using errcode = '22023';
    end if;
    select count(*) filter (where i.archived_at is null), coalesce(max(i.position), 0) + 1 into n, pos
      from public.funnel_items i where i.stage_id = s.id;
    if n >= 50 then
      raise exception 'VALIDATION: 한 단계에는 카드를 50개까지 둘 수 있습니다' using errcode = '22023';
    end if;
  else
    select x.* into s from public.funnel_stages x where x.id = it.stage_id;
  end if;

  update public.funnel_items
     set stage_id = s.id, kind = p_kind, title = app.funnel_trim(p_title), description = nullif(app.funnel_trim(p_description), ''),
         channel = nullif(app.funnel_trim(p_channel), ''), status = p_status, target_note = nullif(app.funnel_trim(p_target_note), ''),
         details = p_details, position = pos
   where id = it.id
   returning revision into r;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (it.workspace_id, 'funnel_item', it.id, uid, 'item_update', r,
          jsonb_build_object('funnel_id', it.funnel_id, 'stage_key', s.stage_key, 'moved', s.id <> it.stage_id));
  return r;
end $$;
revoke execute on function public.update_funnel_item(uuid, integer, uuid, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.update_funnel_item(uuid, integer, uuid, text, text, text, text, text, text, jsonb) to authenticated;

-- 4-6) 카드 보관(삭제 대신)
create or replace function public.archive_funnel_item(p_item_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  it  public.funnel_items%rowtype;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into it
    from public.funnel_items x
   where x.id = p_item_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 카드를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if it.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if it.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 카드입니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(it.funnel_id);
  update public.funnel_items set archived_at = now() where id = it.id returning revision into r;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (it.workspace_id, 'funnel_item', it.id, uid, 'item_archive', r, jsonb_build_object('funnel_id', it.funnel_id));
  return r;
end $$;
revoke execute on function public.archive_funnel_item(uuid, integer) from public, anon;
grant execute on function public.archive_funnel_item(uuid, integer) to authenticated;
