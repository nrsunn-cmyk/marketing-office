-- P2F-BACKEND-01 콘텐츠 제작 브리프(P2-f) 서버. 설계: Plan/Claude-Backend-20261118/P2F-BACKEND-01-DESIGN.md
--
-- 바뀌는 것
--   1) content_briefs: 퍼널 카드 1장 × 채널 1개의 제작 지침. 공통 필드 + 채널별 spec(엄격 객체) + 카피 초안·이미지 가이드.
--      참조 전략 버전은 만들 때 퍼널의 것을 복사, 다시 맞추기는 수동.
--   2) content_brief_claims: 브리프의 주장. 수정·보관(삭제 없음).
--   3) content_claim_sources: 주장의 근거 연결(프로필 버전 항목·프로젝트 자료·프로젝트 외부 출처). 해제는 표시만(삭제 없음).
--   4) funnel_items 에 unique(funnel_id, id) 추가(브리프의 복합 FK 용). 21번 파일은 고치지 않는다.
--   5) 세 표 모두 select 만 본인 업무실, 직접 쓰기 정책 없음 + INSERT·UPDATE·DELETE·TRUNCATE 회수.
--      쓰기는 정의자 RPC 9개만. RPC 마다 감사 기록 1행(entity_type 'content_brief').
--
-- 바뀌지 않는 것: 기존 표·RPC·유형 CHECK·결과물(artifacts) 경로(18–20 유형 일치 트리거와 무관), 퍼널 RPC.
-- 하지 않는 것: 자동 문구 생성(LLM) — copy_origin 에 'ai' 를 두지 않는다(주인님 결정 뒤 migration 으로 추가).
-- 결정하지 않는 것: DEC-P2-01-A(브리프에 승인 흐름 없음), N2(프로필 근거 연결 시 승인 상태를 보지 않음),
--   첫 자체 채널(채널 목록만 두고 우선순위 없음).
--
-- 정의자 함수 규칙(퍼널과 같음): search_path='' 고정·스키마 표기, 맨 앞 auth.uid() 확인,
--   소유 조건을 조회 WHERE 안에 넣어 남의 행은 잠그지 않음, 남의 것·없는 것은 같은 NOT_FOUND, public·anon 실행 권한 회수.

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 문자열 배열: 배열, 개수 ≤ p_max, 각 항목은 문자열이고 앞뒤 정리 뒤 1~p_len 자
create or replace function app.brief_str_array_ok(p jsonb, p_max integer, p_len integer) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= p_max
     and not exists (select 1 from jsonb_array_elements(p) e
                      where jsonb_typeof(e) <> 'string' or length(app.funnel_trim(e #>> '{}')) not between 1 and p_len)
$$;
revoke execute on function app.brief_str_array_ok(jsonb, integer, integer) from public, anon;

-- 문자열 1개: 문자열이고 앞뒤 정리 뒤 1~p_len 자
create or replace function app.brief_str_ok(p jsonb, p_len integer) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'string' and length(app.funnel_trim(p #>> '{}')) between 1 and p_len
$$;
revoke execute on function app.brief_str_ok(jsonb, integer) from public, anon;

-- 채널별 spec: 객체, 그 채널의 키만, 키마다 규칙(설계 4절). 모든 키는 선택.
create or replace function app.brief_spec_ok(p_channel text, p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  allowed text[];
  k text;
  ok boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  allowed := case p_channel
    when 'blog'       then array['titleIdeas', 'outline', 'keywords']
    when 'instagram'  then array['format', 'captionGuide', 'hashtags']
    when 'ad_copy'    then array['platform', 'headlines', 'descriptions']
    when 'linkedin'   then array['outline', 'hashtags']
    when 'newsletter' then array['subjectLines', 'outline']
  end;
  if allowed is null then
    return false;
  end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (allowed)) then
      return false;
    end if;
    -- CASE 안의 then 을 IF 의 then 으로 읽지 않도록 변수에 먼저 담는다
    ok := case k
      when 'titleIdeas'   then app.brief_str_array_ok(p -> k, 5, 200)
      when 'outline'      then app.brief_str_array_ok(p -> k, 20, 300)
      when 'keywords'     then app.brief_str_array_ok(p -> k, 10, 50)
      when 'format'       then jsonb_typeof(p -> k) = 'string' and (p ->> k) in ('feed', 'carousel', 'reel')
      when 'captionGuide' then app.brief_str_ok(p -> k, 1000)
      when 'hashtags'     then app.brief_str_array_ok(p -> k, case p_channel when 'instagram' then 30 else 10 end, 50)
      when 'platform'     then app.brief_str_ok(p -> k, 50)
      when 'headlines'    then app.brief_str_array_ok(p -> k, 5, 60)
      when 'descriptions' then app.brief_str_array_ok(p -> k, 5, 150)
      when 'subjectLines' then app.brief_str_array_ok(p -> k, 5, 100)
      else false
    end;
    if not coalesce(ok, false) then
      return false;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function app.brief_spec_ok(text, jsonb) from public, anon;

-- 선택 글: 앞뒤 정리, 비면 null, 길면 VALIDATION
create or replace function app.brief_text(p text, p_max integer, p_label text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(app.funnel_trim(p), '');
begin
  if v is not null and length(v) > p_max then
    raise exception 'VALIDATION: %은(는) %자 이하여야 합니다', p_label, p_max using errcode = '22023';
  end if;
  return v;
end $$;
revoke execute on function app.brief_text(text, integer, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
alter table public.funnel_items add constraint funnel_items_funnel_id_id_key unique (funnel_id, id);

create table public.content_briefs (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null,
  project_id           uuid not null,
  funnel_id            uuid not null,
  funnel_item_id       uuid not null,
  channel              text not null check (channel in ('blog', 'instagram', 'ad_copy', 'linkedin', 'newsletter')),
  strategy_artifact_id uuid not null,
  strategy_version_id  uuid not null,
  title                text not null check (length(app.funnel_trim(title)) between 1 and 200 and title = app.funnel_trim(title)),
  audience             text check (audience is null or length(audience) between 1 and 500),
  hook                 text check (hook is null or length(hook) between 1 and 300),
  core_message         text check (core_message is null or length(core_message) between 1 and 1000),
  cta                  text check (cta is null or length(cta) between 1 and 200),
  channel_spec         jsonb not null default '{}'::jsonb check (app.brief_spec_ok(channel, channel_spec)),
  copy_draft           text check (copy_draft is null or length(copy_draft) between 1 and 5000),
  copy_origin          text not null default 'manual' check (copy_origin in ('manual', 'template')),
  image_guide          text check (image_guide is null or length(image_guide) between 1 and 2000),
  status               text not null default 'drafting' check (status in ('drafting', 'ready')),
  archived_at          timestamptz,
  revision             integer not null default 1,
  created_by           uuid not null references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- 정리된 값만 저장(앞뒤 공백류 없음). 선택 글은 RPC 가 app.brief_text 로 정리한다
  check (audience = app.funnel_trim(audience) and hook = app.funnel_trim(hook) and core_message = app.funnel_trim(core_message)
         and cta = app.funnel_trim(cta) and copy_draft = app.funnel_trim(copy_draft) and image_guide = app.funnel_trim(image_guide)) ,
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (workspace_id, funnel_id) references public.funnels (workspace_id, id),
  foreign key (funnel_id, funnel_item_id) references public.funnel_items (funnel_id, id),
  foreign key (strategy_artifact_id, strategy_version_id) references public.artifact_versions (artifact_id, id),
  unique (funnel_item_id, channel),
  unique (workspace_id, id)
);

create table public.content_brief_claims (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brief_id     uuid not null,
  text         text not null check (length(app.funnel_trim(text)) between 1 and 500 and text = app.funnel_trim(text)),
  claim_kind   text not null default 'other' check (claim_kind in ('statistic', 'capability', 'reference', 'other')),
  position     integer not null check (position > 0),
  archived_at  timestamptz,
  revision     integer not null default 1,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (workspace_id, brief_id) references public.content_briefs (workspace_id, id),
  unique (workspace_id, id)
);
create index content_brief_claims_brief on public.content_brief_claims (brief_id, position);

create table public.content_claim_sources (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  claim_id                   uuid not null,
  kind                       text not null check (kind in ('profile', 'asset', 'research')),
  company_profile_version_id uuid references public.company_profile_versions (id),
  profile_field              text check (profile_field in ('products', 'audience', 'strengths', 'brand_rules', 'channel_urls')),
  source_asset_id            uuid references public.source_assets (id),
  research_source_id         uuid references public.research_sources (id),
  note                       text check (note is null or (length(note) between 1 and 300 and note = app.funnel_trim(note))),
  unlinked_at                timestamptz,
  created_by                 uuid not null references auth.users (id),
  created_at                 timestamptz not null default now(),
  -- 종류마다 대상은 정확히 하나(artifact_version_refs 와 같은 방식)
  check (
    (kind = 'profile'  and company_profile_version_id is not null and profile_field is not null and source_asset_id is null and research_source_id is null) or
    (kind = 'asset'    and source_asset_id is not null and company_profile_version_id is null and profile_field is null and research_source_id is null) or
    (kind = 'research' and research_source_id is not null and company_profile_version_id is null and profile_field is null and source_asset_id is null)
  ),
  foreign key (workspace_id, claim_id) references public.content_brief_claims (workspace_id, id)
);
create index content_claim_sources_claim on public.content_claim_sources (claim_id) where unlinked_at is null;

create trigger content_briefs_guard before update on public.content_briefs
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'funnel_id', 'funnel_item_id', 'channel',
                                                 'strategy_artifact_id', 'created_by', 'created_at');
create trigger content_brief_claims_guard before update on public.content_brief_claims
  for each row execute function app.guard_update('id', 'workspace_id', 'brief_id', 'created_by', 'created_at');
-- 근거 연결은 해제 표시(unlinked_at)만 바꿀 수 있다. 해제를 되돌리거나 대상을 바꾸려면 새로 연결한다
create trigger content_claim_sources_guard before update on public.content_claim_sources
  for each row execute function app.guard_update('id', 'workspace_id', 'claim_id', 'kind', 'company_profile_version_id', 'profile_field',
                                                 'source_asset_id', 'research_source_id', 'note', 'created_by', 'created_at');
create or replace function app.unlink_once() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.unlinked_at is not null then
    raise exception 'IMMUTABLE_ROW: 해제한 근거 연결은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.unlink_once() from public, anon, authenticated;
create trigger content_claim_sources_unlink_once before update on public.content_claim_sources
  for each row execute function app.unlink_once();
create trigger content_claim_sources_no_delete before delete on public.content_claim_sources
  for each row execute function app.reject_mutation();

-- ─────────────────────────────────────────────
-- 2) RLS·권한
-- ─────────────────────────────────────────────
alter table public.content_briefs        enable row level security;
alter table public.content_brief_claims  enable row level security;
alter table public.content_claim_sources enable row level security;
create policy content_briefs_select        on public.content_briefs        for select to authenticated using (app.owns_workspace(workspace_id));
create policy content_brief_claims_select  on public.content_brief_claims  for select to authenticated using (app.owns_workspace(workspace_id));
create policy content_claim_sources_select on public.content_claim_sources for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.content_briefs, public.content_brief_claims, public.content_claim_sources from anon;
revoke insert, update, delete, truncate on public.content_briefs, public.content_brief_claims, public.content_claim_sources from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미 (정의자 RPC 안에서만)
-- ─────────────────────────────────────────────
-- 브리프를 고칠 수 있는지: 브리프·카드 보관 아님 + 퍼널 열림(작업 취소·프로젝트 보관 아님)
create or replace function app.assert_brief_open(p_brief_id uuid) returns void
language plpgsql stable set search_path = '' as $$
declare
  b public.content_briefs%rowtype;
  item_archived timestamptz;
begin
  select * into b from public.content_briefs where id = p_brief_id;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 브리프는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  select i.archived_at into item_archived from public.funnel_items i where i.id = b.funnel_item_id;
  if item_archived is not null then
    raise exception 'INVALID_TRANSITION: 보관한 퍼널 카드의 브리프는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(b.funnel_id);
end $$;
revoke execute on function app.assert_brief_open(uuid) from public, anon, authenticated;

create or replace function app.brief_audit(p_ws uuid, p_brief uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'content_brief', p_brief, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.brief_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 브리프 만들기(템플릿 초기값). 같은 카드·채널이 있으면 기존 것
create or replace function public.create_content_brief(
  p_funnel_item_id uuid,
  p_channel        text,
  p_title          text,
  p_audience       text default null,
  p_core_message   text default null,
  p_cta            text default null,
  p_channel_spec   jsonb default '{}'::jsonb
) returns table (brief_id uuid, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  it   public.funnel_items%rowtype;
  f    public.funnels%rowtype;
  b_id uuid;
  t    text := nullif(app.funnel_trim(p_title), '');
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  -- 같은 카드·채널을 동시에 두 번 만들지 않도록 카드 행을 잠근다(본인 것만)
  select x.* into it
    from public.funnel_items x
   where x.id = p_funnel_item_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 퍼널 카드를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_channel is null or p_channel not in ('blog', 'instagram', 'ad_copy', 'linkedin', 'newsletter') then
    raise exception 'VALIDATION: 알 수 없는 채널입니다' using errcode = '22023';
  end if;
  select b.id into b_id from public.content_briefs b where b.funnel_item_id = it.id and b.channel = p_channel;
  if found then
    return query select b_id, true;
    return;
  end if;
  if it.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 퍼널 카드에는 브리프를 만들 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(it.funnel_id);
  if t is null or length(t) > 200 then
    raise exception 'VALIDATION: 제목은 1~200자여야 합니다' using errcode = '22023';
  end if;
  if not app.brief_spec_ok(p_channel, coalesce(p_channel_spec, '{}'::jsonb)) then
    raise exception 'VALIDATION: 채널별 항목 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  select * into f from public.funnels where id = it.funnel_id;

  insert into public.content_briefs (workspace_id, project_id, funnel_id, funnel_item_id, channel, strategy_artifact_id, strategy_version_id,
                                     title, audience, core_message, cta, channel_spec, created_by)
  values (it.workspace_id, f.project_id, f.id, it.id, p_channel, f.strategy_artifact_id, f.strategy_version_id,
          t, app.brief_text(p_audience, 500, '타깃 독자'), app.brief_text(p_core_message, 1000, '핵심 요지'),
          app.brief_text(p_cta, 200, 'CTA'), coalesce(p_channel_spec, '{}'::jsonb), uid)
  returning id into b_id;
  perform app.brief_audit(it.workspace_id, b_id, 'brief_create', 1,
                          jsonb_build_object('funnel_item_id', it.id, 'channel', p_channel, 'strategy_version_id', f.strategy_version_id));
  return query select b_id, false;
end $$;
revoke execute on function public.create_content_brief(uuid, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_content_brief(uuid, text, text, text, text, text, jsonb) to authenticated;

-- 4-2) 브리프 수정(값 전체 교체)
create or replace function public.update_content_brief(
  p_brief_id          uuid,
  p_expected_revision integer,
  p_title             text,
  p_audience          text,
  p_hook              text,
  p_core_message      text,
  p_cta               text,
  p_channel_spec      jsonb,
  p_copy_draft        text,
  p_copy_origin       text,
  p_image_guide       text,
  p_status            text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  b   public.content_briefs%rowtype;
  t   text := nullif(app.funnel_trim(p_title), '');
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into b
    from public.content_briefs x
   where x.id = p_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(b.id);
  if t is null or length(t) > 200 then
    raise exception 'VALIDATION: 제목은 1~200자여야 합니다' using errcode = '22023';
  end if;
  if not app.brief_spec_ok(b.channel, coalesce(p_channel_spec, '{}'::jsonb)) then
    raise exception 'VALIDATION: 채널별 항목 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  if p_copy_origin is null or p_copy_origin not in ('manual', 'template') then
    raise exception 'VALIDATION: 알 수 없는 카피 작성 방식입니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('drafting', 'ready') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
  update public.content_briefs
     set title = t,
         audience = app.brief_text(p_audience, 500, '타깃 독자'),
         hook = app.brief_text(p_hook, 300, '훅 문장'),
         core_message = app.brief_text(p_core_message, 1000, '핵심 요지'),
         cta = app.brief_text(p_cta, 200, 'CTA'),
         channel_spec = coalesce(p_channel_spec, '{}'::jsonb),
         copy_draft = app.brief_text(p_copy_draft, 5000, '카피 초안'),
         copy_origin = p_copy_origin,
         image_guide = app.brief_text(p_image_guide, 2000, '이미지 가이드'),
         status = p_status
   where id = b.id
   returning revision into r;
  perform app.brief_audit(b.workspace_id, b.id, 'brief_update', r, jsonb_build_object('status', p_status));
  return r;
end $$;
revoke execute on function public.update_content_brief(uuid, integer, text, text, text, text, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.update_content_brief(uuid, integer, text, text, text, text, text, jsonb, text, text, text, text) to authenticated;

-- 4-3) 다시 맞추기: 참조 전략 버전을 지금 승인본으로(수동). 프로필 근거가 새 전략의 프로필과 다르면 거절
create or replace function public.rebase_content_brief(p_brief_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  b   public.content_briefs%rowtype;
  ap  uuid;
  new_profile text;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into b
    from public.content_briefs x
   where x.id = p_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(b.id);
  select a.approved_version_id into ap from public.artifacts a where a.id = b.strategy_artifact_id;
  if ap is null then
    raise exception 'STRATEGY_NOT_APPROVED: 승인된 전략이 없습니다' using errcode = 'P0001';
  end if;
  if ap = b.strategy_version_id then
    raise exception 'VALIDATION: 이미 지금 승인된 전략 기준입니다' using errcode = '22023';
  end if;
  select v.content #>> '{profileRef,id}' into new_profile from public.artifact_versions v where v.id = ap;
  if exists (
    select 1 from public.content_claim_sources s join public.content_brief_claims c on c.id = s.claim_id
     where c.brief_id = b.id and c.archived_at is null and s.unlinked_at is null and s.kind = 'profile'
       and s.company_profile_version_id::text is distinct from new_profile
  ) then
    raise exception 'VALIDATION: 새 전략은 다른 회사 프로필 버전을 씁니다. 이전 프로필 근거를 먼저 해제해 주세요' using errcode = '22023';
  end if;
  update public.content_briefs set strategy_version_id = ap where id = b.id returning revision into r;
  perform app.brief_audit(b.workspace_id, b.id, 'brief_rebase', r, jsonb_build_object('from_version_id', b.strategy_version_id, 'to_version_id', ap));
  return r;
end $$;
revoke execute on function public.rebase_content_brief(uuid, integer) from public, anon;
grant execute on function public.rebase_content_brief(uuid, integer) to authenticated;

-- 4-4) 브리프 보관
create or replace function public.archive_content_brief(p_brief_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  b   public.content_briefs%rowtype;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into b
    from public.content_briefs x
   where x.id = p_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 브리프입니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(b.funnel_id);
  update public.content_briefs set archived_at = now() where id = b.id returning revision into r;
  perform app.brief_audit(b.workspace_id, b.id, 'brief_archive', r, '{}'::jsonb);
  return r;
end $$;
revoke execute on function public.archive_content_brief(uuid, integer) from public, anon;
grant execute on function public.archive_content_brief(uuid, integer) to authenticated;

-- 4-5) 주장 추가(맨 끝). 브리프 행을 잠가 순서·개수 계산이 겹치지 않게 한다
create or replace function public.add_brief_claim(p_brief_id uuid, p_text text, p_claim_kind text default 'other')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  b    public.content_briefs%rowtype;
  t    text := nullif(app.funnel_trim(p_text), '');
  n    integer;
  pos  integer;
  c_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into b
    from public.content_briefs x
   where x.id = p_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  perform app.assert_brief_open(b.id);
  if t is null or length(t) > 500 then
    raise exception 'VALIDATION: 주장 문장은 1~500자여야 합니다' using errcode = '22023';
  end if;
  if p_claim_kind is null or p_claim_kind not in ('statistic', 'capability', 'reference', 'other') then
    raise exception 'VALIDATION: 알 수 없는 주장 종류입니다' using errcode = '22023';
  end if;
  select count(*) filter (where c.archived_at is null), coalesce(max(c.position), 0) + 1 into n, pos
    from public.content_brief_claims c where c.brief_id = b.id;
  if n >= 30 then
    raise exception 'VALIDATION: 한 브리프에는 주장을 30개까지 둘 수 있습니다' using errcode = '22023';
  end if;
  insert into public.content_brief_claims (workspace_id, brief_id, text, claim_kind, position, created_by)
  values (b.workspace_id, b.id, t, p_claim_kind, pos, uid)
  returning id into c_id;
  perform app.brief_audit(b.workspace_id, b.id, 'claim_add', 1, jsonb_build_object('claim_id', c_id, 'kind', p_claim_kind));
  return c_id;
end $$;
revoke execute on function public.add_brief_claim(uuid, text, text) from public, anon;
grant execute on function public.add_brief_claim(uuid, text, text) to authenticated;

-- 4-6) 주장 수정
create or replace function public.update_brief_claim(p_claim_id uuid, p_expected_revision integer, p_text text, p_claim_kind text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c   public.content_brief_claims%rowtype;
  t   text := nullif(app.funnel_trim(p_text), '');
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into c
    from public.content_brief_claims x
   where x.id = p_claim_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 주장을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if c.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if c.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 주장은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(c.brief_id);
  if t is null or length(t) > 500 then
    raise exception 'VALIDATION: 주장 문장은 1~500자여야 합니다' using errcode = '22023';
  end if;
  if p_claim_kind is null or p_claim_kind not in ('statistic', 'capability', 'reference', 'other') then
    raise exception 'VALIDATION: 알 수 없는 주장 종류입니다' using errcode = '22023';
  end if;
  update public.content_brief_claims set text = t, claim_kind = p_claim_kind where id = c.id returning revision into r;
  perform app.brief_audit(c.workspace_id, c.brief_id, 'claim_update', r, jsonb_build_object('claim_id', c.id));
  return r;
end $$;
revoke execute on function public.update_brief_claim(uuid, integer, text, text) from public, anon;
grant execute on function public.update_brief_claim(uuid, integer, text, text) to authenticated;

-- 4-7) 주장 보관
create or replace function public.archive_brief_claim(p_claim_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c   public.content_brief_claims%rowtype;
  r   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into c
    from public.content_brief_claims x
   where x.id = p_claim_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 주장을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if c.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if c.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 주장입니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(c.brief_id);
  update public.content_brief_claims set archived_at = now() where id = c.id returning revision into r;
  perform app.brief_audit(c.workspace_id, c.brief_id, 'claim_archive', r, jsonb_build_object('claim_id', c.id));
  return r;
end $$;
revoke execute on function public.archive_brief_claim(uuid, integer) from public, anon;
grant execute on function public.archive_brief_claim(uuid, integer) to authenticated;

-- 4-8) 근거 연결. 주장 행을 잠가 개수·중복 확인이 겹치지 않게 한다
--   profile: 브리프가 참조한 전략 버전의 profileRef 와 같은 프로필 버전만(승인 상태는 보지 않음, N2)
--   asset·research: 같은 업무실·같은 프로젝트만. 남의 것·다른 프로젝트 것은 같은 문구(존재 여부를 알려 주지 않음)
create or replace function public.link_claim_source(
  p_claim_id      uuid,
  p_kind          text,
  p_target_id     uuid,
  p_profile_field text default null,
  p_note          text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  c    public.content_brief_claims%rowtype;
  b    public.content_briefs%rowtype;
  nt   text;
  n    integer;
  s_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into c
    from public.content_brief_claims x
   where x.id = p_claim_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 주장을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if c.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 주장에는 근거를 연결할 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(c.brief_id);
  select * into b from public.content_briefs where id = c.brief_id;
  nt := app.brief_text(p_note, 300, '근거 메모');

  if p_kind = 'profile' then
    if p_profile_field is null or p_profile_field not in ('products', 'audience', 'strengths', 'brand_rules', 'channel_urls') then
      raise exception 'VALIDATION: 알 수 없는 프로필 항목입니다' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.artifact_versions v
       where v.id = b.strategy_version_id and v.content #>> '{profileRef,id}' = p_target_id::text
    ) or not exists (select 1 from public.company_profile_versions pv where pv.id = p_target_id and pv.workspace_id = b.workspace_id) then
      raise exception 'SOURCE_MISMATCH: 브리프가 참조한 전략의 회사 프로필 버전만 근거로 쓸 수 있습니다' using errcode = 'P0001';
    end if;
  elsif p_kind = 'asset' then
    if p_profile_field is not null or not exists (
      select 1 from public.source_assets a where a.id = p_target_id and a.workspace_id = b.workspace_id and a.project_id = b.project_id
    ) then
      raise exception 'SOURCE_MISMATCH: 이 프로젝트의 자료만 근거로 쓸 수 있습니다' using errcode = 'P0001';
    end if;
  elsif p_kind = 'research' then
    if p_profile_field is not null or not exists (
      select 1 from public.research_sources rs where rs.id = p_target_id and rs.workspace_id = b.workspace_id and rs.project_id = b.project_id
    ) then
      raise exception 'SOURCE_MISMATCH: 이 프로젝트의 외부 출처만 근거로 쓸 수 있습니다' using errcode = 'P0001';
    end if;
  else
    raise exception 'VALIDATION: 알 수 없는 근거 종류입니다' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.content_claim_sources s
     where s.claim_id = c.id and s.unlinked_at is null and s.kind = p_kind
       and coalesce(s.company_profile_version_id, s.source_asset_id, s.research_source_id) = p_target_id
       and s.profile_field is not distinct from p_profile_field
  ) then
    raise exception 'VALIDATION: 이미 연결한 근거입니다' using errcode = '22023';
  end if;
  select count(*) into n from public.content_claim_sources s where s.claim_id = c.id and s.unlinked_at is null;
  if n >= 10 then
    raise exception 'VALIDATION: 한 주장에는 근거를 10개까지 연결할 수 있습니다' using errcode = '22023';
  end if;

  insert into public.content_claim_sources (workspace_id, claim_id, kind, company_profile_version_id, profile_field, source_asset_id, research_source_id, note, created_by)
  values (c.workspace_id, c.id, p_kind,
          case when p_kind = 'profile' then p_target_id end, case when p_kind = 'profile' then p_profile_field end,
          case when p_kind = 'asset' then p_target_id end, case when p_kind = 'research' then p_target_id end, nt, uid)
  returning id into s_id;
  perform app.brief_audit(c.workspace_id, c.brief_id, 'source_link', null,
                          jsonb_build_object('claim_id', c.id, 'source_id', s_id, 'kind', p_kind, 'target_id', p_target_id));
  return s_id;
end $$;
revoke execute on function public.link_claim_source(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.link_claim_source(uuid, text, uuid, text, text) to authenticated;

-- 4-9) 근거 해제(표시만)
create or replace function public.unlink_claim_source(p_source_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s   public.content_claim_sources%rowtype;
  c   public.content_brief_claims%rowtype;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into s
    from public.content_claim_sources x
   where x.id = p_source_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 근거 연결을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if s.unlinked_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 해제한 근거입니다' using errcode = 'P0001';
  end if;
  select * into c from public.content_brief_claims where id = s.claim_id;
  perform app.assert_brief_open(c.brief_id);
  update public.content_claim_sources set unlinked_at = now() where id = s.id;
  perform app.brief_audit(s.workspace_id, c.brief_id, 'source_unlink', null, jsonb_build_object('claim_id', c.id, 'source_id', s.id));
end $$;
revoke execute on function public.unlink_claim_source(uuid) from public, anon;
grant execute on function public.unlink_claim_source(uuid) to authenticated;
