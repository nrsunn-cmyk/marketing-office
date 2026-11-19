-- P2E-BACKEND-01 리드마그넷 기획(P2-e) 서버. 설계: Plan/Claude-Backend-20261118/P2E-BACKEND-01-DESIGN.md
--
-- 바뀌는 것
--   1) lead_magnets: 퍼널에 속한 리드마그넷 기획(퍼널 1 : N). 연결 퍼널 단계 1개, 형식·대상·약속하는 가치·전달 방식·
--      수집할 정보·구성·상태. 참조 전략 버전은 만들 때 퍼널의 것을 복사, 다시 맞추기는 수동(DEC-P2-01-A: stale 표시만).
--   2) funnel_items.lead_magnet_id: 전환 오퍼(cta)·리드마그넷 카드가 가리키는 같은 퍼널의 리드마그넷(빈 값 허용).
--   3) select 만 본인 업무실, 직접 쓰기 정책 없음 + INSERT·UPDATE·DELETE·TRUNCATE 회수.
--      쓰기는 정의자 RPC 5개만(create/update/rebase/archive_lead_magnet, set_funnel_item_lead_magnet). RPC 마다 감사 1행.
--   4) update_funnel_item: 인자·반환은 그대로, 본문에 "연결된 카드는 content 로 바꿀 수 없음" 검사만 더한다.
--
-- 바뀌지 않는 것: 퍼널 카드의 lead_magnet 유형과 details(자동 옮기기 없음), 다른 퍼널·브리프 RPC, 기존 표 데이터.
-- 하지 않는 것: 브리프 → 리드마그넷 CTA 참조(설계 9절 제안만).
--
-- 정의자 함수 규칙(퍼널·브리프와 같음): search_path='' 고정·스키마 표기, 맨 앞 auth.uid() 확인,
--   소유 조건을 조회 WHERE 안에 넣어 남의 행은 잠그지 않음, 남의 것·없는 것은 같은 NOT_FOUND, public·anon 실행 권한 회수.

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 문자열 배열을 항목별로 앞뒤 정리해 같은 순서로 돌려준다(검사는 app.brief_str_array_ok 가 한다)
create or replace function app.lead_str_array(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(app.funnel_trim(e.v #>> '{}')) order by e.n), '[]'::jsonb)
    from jsonb_array_elements(p) with ordinality as e(v, n)
$$;
revoke execute on function app.lead_str_array(jsonb) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
create table public.lead_magnets (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null,
  project_id           uuid not null,
  funnel_id            uuid not null,
  stage_id             uuid not null,
  strategy_artifact_id uuid not null,
  strategy_version_id  uuid not null,
  title                text not null check (length(title) between 1 and 200),
  format               text not null check (format in ('checklist', 'guide', 'template', 'diagnosis', 'webinar', 'sample', 'consultation', 'other')),
  audience             text check (audience is null or length(audience) between 1 and 500),
  promise              text check (promise is null or length(promise) between 1 and 500),
  delivery             text check (delivery is null or delivery in ('download', 'email', 'web_page', 'message', 'in_person', 'other')),
  lead_fields          jsonb not null default '[]'::jsonb check (app.brief_str_array_ok(lead_fields, 10, 50)),
  outline              jsonb not null default '[]'::jsonb check (app.brief_str_array_ok(outline, 20, 300)),
  status               text not null default 'planned' check (status in ('planned', 'drafting', 'ready', 'live')),
  archived_at          timestamptz,
  revision             integer not null default 1,
  created_by           uuid not null references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- 정리된 값만 저장(앞뒤 공백류 없음)
  check (title = app.funnel_trim(title) and audience = app.funnel_trim(audience) and promise = app.funnel_trim(promise)),
  check (lead_fields = app.lead_str_array(lead_fields) and outline = app.lead_str_array(outline)),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (workspace_id, funnel_id) references public.funnels (workspace_id, id),
  -- 연결 단계는 같은 퍼널의 단계만
  foreign key (funnel_id, stage_id) references public.funnel_stages (funnel_id, id),
  foreign key (strategy_artifact_id, strategy_version_id) references public.artifact_versions (artifact_id, id),
  unique (workspace_id, id),
  unique (funnel_id, id)
);
create index lead_magnets_active on public.lead_magnets (funnel_id, created_at) where archived_at is null;
create index lead_magnets_stage on public.lead_magnets (stage_id);

create trigger lead_magnets_guard before update on public.lead_magnets
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'funnel_id', 'strategy_artifact_id', 'created_by', 'created_at');

-- 카드 → 리드마그넷(같은 퍼널만). 빈 값이면 FK 를 보지 않는다(MATCH SIMPLE)
alter table public.funnel_items add column lead_magnet_id uuid;
alter table public.funnel_items
  add constraint funnel_items_lead_magnet_fk foreign key (funnel_id, lead_magnet_id) references public.lead_magnets (funnel_id, id),
  add constraint funnel_items_lead_magnet_kind check (lead_magnet_id is null or kind in ('cta', 'lead_magnet'));
create index funnel_items_lead_magnet on public.funnel_items (lead_magnet_id) where lead_magnet_id is not null;

-- ─────────────────────────────────────────────
-- 2) RLS·권한: select 만 본인 업무실, 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.lead_magnets enable row level security;
create policy lead_magnets_select on public.lead_magnets for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.lead_magnets from anon;
revoke insert, update, delete, truncate on public.lead_magnets from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미 (정의자 RPC 안에서만 부른다)
-- ─────────────────────────────────────────────
-- 값 검사(문구를 구체적으로 돌려주려고 CHECK 앞에서 한 번 더 본다)
create or replace function app.check_lead_magnet(
  p_title text, p_format text, p_audience text, p_promise text, p_delivery text, p_lead_fields jsonb, p_outline jsonb, p_status text
) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(length(app.funnel_trim(p_title)), 0) not between 1 and 200 then
    raise exception 'VALIDATION: 제목은 1~200자여야 합니다' using errcode = '22023';
  end if;
  if p_format is null or p_format not in ('checklist', 'guide', 'template', 'diagnosis', 'webinar', 'sample', 'consultation', 'other') then
    raise exception 'VALIDATION: 알 수 없는 리드마그넷 형식입니다' using errcode = '22023';
  end if;
  if p_audience is not null and length(app.funnel_trim(p_audience)) > 500 then
    raise exception 'VALIDATION: 대상은 500자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_promise is not null and length(app.funnel_trim(p_promise)) > 500 then
    raise exception 'VALIDATION: 약속하는 가치는 500자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_delivery is not null and p_delivery not in ('download', 'email', 'web_page', 'message', 'in_person', 'other') then
    raise exception 'VALIDATION: 알 수 없는 전달 방식입니다' using errcode = '22023';
  end if;
  if not app.brief_str_array_ok(coalesce(p_lead_fields, '[]'::jsonb), 10, 50) then
    raise exception 'VALIDATION: 수집할 정보는 10개까지, 각 1~50자여야 합니다' using errcode = '22023';
  end if;
  if not app.brief_str_array_ok(coalesce(p_outline, '[]'::jsonb), 20, 300) then
    raise exception 'VALIDATION: 구성은 20줄까지, 각 1~300자여야 합니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('planned', 'drafting', 'ready', 'live') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
end $$;
revoke execute on function app.check_lead_magnet(text, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;

create or replace function app.lead_magnet_audit(p_ws uuid, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'lead_magnet', p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.lead_magnet_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 만들기. 퍼널 행을 잠가 개수 한도 계산이 겹치지 않게 한다
--   잠금 순서(R1, QA-P2E-BACKEND-01 O1): 퍼널 RPC 전체가 "카드 → 리드마그넷 → 단계 → 퍼널" 한 방향으로 잠근다.
--   add_funnel_item 은 단계 FOR UPDATE → (카드 FK) 퍼널 KEY SHARE 다. 여기서 퍼널을 먼저 잠그면 순서가 반대라
--   PG 17 에서 40P01(교착)이 났다. 그래서 단계를 FOR KEY SHARE 로 먼저 잡고, 퍼널은 그 뒤에 잠근다.
--   퍼널은 FOR NO KEY UPDATE 로 잠근다: 만들기끼리는 서로 기다려 한도 계산이 겹치지 않고,
--   카드·브리프를 넣을 때의 FK KEY SHARE 와는 부딪치지 않아 기다림도 줄어든다.
create or replace function public.create_lead_magnet(
  p_stage_id    uuid,
  p_title       text,
  p_format      text,
  p_audience    text default null,
  p_promise     text default null,
  p_delivery    text default null,
  p_lead_fields jsonb default '[]'::jsonb,
  p_outline     jsonb default '[]'::jsonb,
  p_status      text default 'planned'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  s    public.funnel_stages%rowtype;
  f    public.funnels%rowtype;
  n    integer;
  m_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into s
    from public.funnel_stages x
   where x.id = p_stage_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for key share of x;
  if not found then
    raise exception 'NOT_FOUND: 퍼널 단계를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  select x.* into f from public.funnels x where x.id = s.funnel_id for no key update of x;
  perform app.assert_funnel_open(f.id);
  perform app.check_lead_magnet(p_title, p_format, nullif(app.funnel_trim(p_audience), ''), nullif(app.funnel_trim(p_promise), ''),
                                p_delivery, p_lead_fields, p_outline, p_status);
  select count(*) into n from public.lead_magnets m where m.funnel_id = f.id and m.archived_at is null;
  if n >= 20 then
    raise exception 'VALIDATION: 한 퍼널에는 리드마그넷을 20개까지 둘 수 있습니다' using errcode = '22023';
  end if;
  insert into public.lead_magnets (workspace_id, project_id, funnel_id, stage_id, strategy_artifact_id, strategy_version_id,
                                   title, format, audience, promise, delivery, lead_fields, outline, status, created_by)
  values (f.workspace_id, f.project_id, f.id, s.id, f.strategy_artifact_id, f.strategy_version_id,
          app.funnel_trim(p_title), p_format, nullif(app.funnel_trim(p_audience), ''), nullif(app.funnel_trim(p_promise), ''), p_delivery,
          app.lead_str_array(coalesce(p_lead_fields, '[]'::jsonb)), app.lead_str_array(coalesce(p_outline, '[]'::jsonb)), p_status, uid)
  returning id into m_id;
  perform app.lead_magnet_audit(f.workspace_id, m_id, 'lead_magnet_create', 1,
                                jsonb_build_object('funnel_id', f.id, 'stage_key', s.stage_key, 'format', p_format,
                                                   'strategy_version_id', f.strategy_version_id));
  return m_id;
end $$;
revoke execute on function public.create_lead_magnet(uuid, text, text, text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.create_lead_magnet(uuid, text, text, text, text, text, jsonb, jsonb, text) to authenticated;

-- 4-2) 수정(값 전체 교체). 단계는 같은 퍼널 안에서만 바꾼다
create or replace function public.update_lead_magnet(
  p_lead_magnet_id    uuid,
  p_expected_revision integer,
  p_stage_id          uuid,
  p_title             text,
  p_format            text,
  p_audience          text,
  p_promise           text,
  p_delivery          text,
  p_lead_fields       jsonb,
  p_outline           jsonb,
  p_status            text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m   public.lead_magnets%rowtype;
  sk  text;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into m
    from public.lead_magnets x
   where x.id = p_lead_magnet_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 리드마그넷을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if m.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if m.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 리드마그넷은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(m.funnel_id);
  perform app.check_lead_magnet(p_title, p_format, nullif(app.funnel_trim(p_audience), ''), nullif(app.funnel_trim(p_promise), ''),
                                p_delivery, p_lead_fields, p_outline, p_status);
  -- 같은 퍼널의 단계만. 다른 퍼널·남의 단계는 구분하지 않고 같은 문구
  select x.stage_key into sk from public.funnel_stages x where x.id = p_stage_id and x.funnel_id = m.funnel_id;
  if not found then
    raise exception 'VALIDATION: 같은 퍼널의 단계만 고를 수 있습니다' using errcode = '22023';
  end if;
  update public.lead_magnets
     set stage_id = p_stage_id, title = app.funnel_trim(p_title), format = p_format,
         audience = nullif(app.funnel_trim(p_audience), ''), promise = nullif(app.funnel_trim(p_promise), ''), delivery = p_delivery,
         lead_fields = app.lead_str_array(coalesce(p_lead_fields, '[]'::jsonb)), outline = app.lead_str_array(coalesce(p_outline, '[]'::jsonb)),
         status = p_status
   where id = m.id
   returning revision into r;
  perform app.lead_magnet_audit(m.workspace_id, m.id, 'lead_magnet_update', r,
                                jsonb_build_object('stage_key', sk, 'status', p_status, 'moved', p_stage_id <> m.stage_id));
  return r;
end $$;
revoke execute on function public.update_lead_magnet(uuid, integer, uuid, text, text, text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.update_lead_magnet(uuid, integer, uuid, text, text, text, text, text, jsonb, jsonb, text) to authenticated;

-- 4-3) 다시 맞추기: 참조 전략 버전을 지금 승인본으로. 주인님이 누를 때만(자동 없음)
create or replace function public.rebase_lead_magnet(p_lead_magnet_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m   public.lead_magnets%rowtype;
  ap  uuid;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into m
    from public.lead_magnets x
   where x.id = p_lead_magnet_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 리드마그넷을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if m.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if m.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 리드마그넷은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(m.funnel_id);
  select a.approved_version_id into ap from public.artifacts a where a.id = m.strategy_artifact_id;
  if ap is null then
    raise exception 'STRATEGY_NOT_APPROVED: 승인된 전략이 없습니다' using errcode = 'P0001';
  end if;
  if ap = m.strategy_version_id then
    raise exception 'VALIDATION: 이미 지금 승인된 전략 기준입니다' using errcode = '22023';
  end if;
  update public.lead_magnets set strategy_version_id = ap where id = m.id returning revision into r;
  perform app.lead_magnet_audit(m.workspace_id, m.id, 'lead_magnet_rebase', r,
                                jsonb_build_object('from_version_id', m.strategy_version_id, 'to_version_id', ap));
  return r;
end $$;
revoke execute on function public.rebase_lead_magnet(uuid, integer) from public, anon;
grant execute on function public.rebase_lead_magnet(uuid, integer) to authenticated;

-- 4-4) 보관(삭제 대신). 이 리드마그넷을 가리키는 카드 연결은 남는다(화면이 "보관된 리드마그넷"으로 표시)
create or replace function public.archive_lead_magnet(p_lead_magnet_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m   public.lead_magnets%rowtype;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into m
    from public.lead_magnets x
   where x.id = p_lead_magnet_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 리드마그넷을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if m.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if m.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 리드마그넷입니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(m.funnel_id);
  update public.lead_magnets set archived_at = now() where id = m.id returning revision into r;
  perform app.lead_magnet_audit(m.workspace_id, m.id, 'lead_magnet_archive', r, jsonb_build_object('funnel_id', m.funnel_id));
  return r;
end $$;
revoke execute on function public.archive_lead_magnet(uuid, integer) from public, anon;
grant execute on function public.archive_lead_magnet(uuid, integer) to authenticated;

-- 4-5) 카드 연결·해제. p_lead_magnet_id 가 null 이면 해제
create or replace function public.set_funnel_item_lead_magnet(p_item_id uuid, p_expected_revision integer, p_lead_magnet_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  it  public.funnel_items%rowtype;
  ma  timestamptz;
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
  if p_lead_magnet_id is not null then
    if it.kind not in ('cta', 'lead_magnet') then
      raise exception 'VALIDATION: 전환 오퍼·리드마그넷 카드만 리드마그넷을 가리킬 수 있습니다' using errcode = '22023';
    end if;
    -- 같은 퍼널의 리드마그넷만. 다른 퍼널·남의 것은 구분하지 않고 같은 문구
    select m.archived_at into ma from public.lead_magnets m where m.id = p_lead_magnet_id and m.funnel_id = it.funnel_id;
    if not found then
      raise exception 'VALIDATION: 같은 퍼널의 리드마그넷만 연결할 수 있습니다' using errcode = '22023';
    end if;
    if ma is not null then
      raise exception 'INVALID_TRANSITION: 보관한 리드마그넷에는 연결할 수 없습니다' using errcode = 'P0001';
    end if;
  end if;
  if it.lead_magnet_id is not distinct from p_lead_magnet_id then
    raise exception 'VALIDATION: 이미 그렇게 연결되어 있습니다' using errcode = '22023';
  end if;
  update public.funnel_items set lead_magnet_id = p_lead_magnet_id where id = it.id returning revision into r;
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (it.workspace_id, 'funnel_item', it.id, uid, 'item_link_lead_magnet', r,
          jsonb_build_object('funnel_id', it.funnel_id, 'from_lead_magnet_id', it.lead_magnet_id, 'to_lead_magnet_id', p_lead_magnet_id));
  return r;
end $$;
revoke execute on function public.set_funnel_item_lead_magnet(uuid, integer, uuid) from public, anon;
grant execute on function public.set_funnel_item_lead_magnet(uuid, integer, uuid) to authenticated;

-- 4-6) 카드 수정(21번과 같은 인자·반환). 리드마그넷이 연결된 카드는 content 로 바꿀 수 없다는 검사만 더했다
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
  if it.lead_magnet_id is not null and p_kind not in ('cta', 'lead_magnet') then
    raise exception 'VALIDATION: 리드마그넷과 연결된 카드는 콘텐츠 유형으로 바꿀 수 없습니다. 연결을 먼저 해제해 주세요' using errcode = '22023';
  end if;

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
