-- P3E-BACKEND-IMPL-01 PPT 구성·템플릿(P3-e) 서버. 설계: Plan/Claude-Backend-20261120/P3E-BACKEND-01-DESIGN.md (Master 수락: D1 A안, D2 이미지 1차 제외)
-- 범위: 확정(ready)·보관 안 된 제작 브리프(포함 산출물에 ppt_deck)를 바탕으로 PPT 구성안(슬라이드 목록)을 판 단위로 남긴다.
--   .pptx·.md 내보내기는 앱 경로 처리기가 이 표를 읽어 만든다(DB 는 쓰기·규칙만). AI·외부 API 호출 없음(X11).
--
-- 구성안: 저장할 때마다 새 판(제목·템플릿·상태·슬라이드 전체 스냅샷, 판 20 — AGY 결정 5). 슬라이드 빼기 = 목록에서 제거,
--   되살리기는 옛 판 되돌리기(슬라이드 id 유지). 슬라이드 자산 {asset_id, version_no}: 판 번호는 서버가 찍고(새로 넣은 것만 그 순간
--   current_version_no, 이미 연결된 것은 그대로) → 자산 새 판이면 이전 기준(stale), 푸는 길은 맞추기(rebase)뿐. P3-d 와 같은 규칙.
-- 제어 문자(\u0001-\u0008, \u000B-\u000D, \u000E-\u001F, \u007F)는 저장 때 거절한다(내보내기 XML 이 깨지지 않게, Tester ES1. CR 은 P3DE-BACKEND-FIX-01). 줄바꿈(\n)·탭은 허용.
-- 템플릿은 3종 키만(royal_grid·minimal_report·brand_deck). 값(색·글꼴·좌표)은 앱 코드 상수(AGY P3E-TEMPLATES.md)라 DB 에는 키만 있다.
--
-- 바뀌는 것: ppt_decks(머리), ppt_deck_versions(판, 추가 전용), 정의자 RPC 5개, 감사 1행(entity_type 'ppt_deck', 제목·요점·메모 글자 없음)
-- 바뀌지 않는 것: 기존 표·RPC·버킷·서명 비밀값(업로드가 없어 새 키 없음).
-- 잠금: 만들기는 브리프 FOR SHARE → advisory(34001, 브리프). 그 밖에는 구성안 한 행 FOR UPDATE.
-- migration 이름: ADMIN-P4(20261121009000) 다음.

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 글 칸: 1~max 자(코드 포인트), 앞뒤 공백 없음, 제어 문자 없음(줄바꿈 \n·탭은 허용. CR \r 은 거절 — 앱은 \r\n 을 \n 으로 바꿔 보내고
--   .md 내보내기는 LF 만이라서. P3DE-BACKEND-FIX-01, Tester QA-P3E-PREP-01 D3)
create or replace function app.ppt_text_ok(p text, p_max integer) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(char_length(p) between 1 and p_max and p = btrim(p) and p !~ '[\u0001-\u0008\u000B-\u000D\u000E-\u001F\u007F]', false)
$$;
revoke execute on function app.ppt_text_ok(text, integer) from public, anon;

-- 저장된 슬라이드 목록 모양(판 표 CHECK). 1~40장, 키 정확히 5개, id 소문자 uuid·서로 다름, 제목 1~100, 요점·메모 null·1~1000,
--   자산 0~10개 {asset_id(소문자 uuid, 서로 다름), version_no(정수 ≥1)}
create or replace function app.ppt_slides_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  s    jsonb;
  a    jsonb;
  ids  text[] := '{}'::text[];
  aids text[];
begin
  if app.jt(p) <> 'array' or jsonb_array_length(p) not between 1 and 40 then
    return false;
  end if;
  for s in select e from jsonb_array_elements(p) e loop
    if app.jt(s) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(s) k) <> array['assets', 'bullets', 'id', 'notes', 'title'] then
      return false;
    end if;
    if app.jt(s -> 'id') <> 'string' or (s ->> 'id') !~ uuid_re or (s ->> 'id') = any(ids) then
      return false;
    end if;
    ids := array_append(ids, s ->> 'id');
    if app.jt(s -> 'title') <> 'string' or not app.ppt_text_ok(s ->> 'title', 100) then
      return false;
    end if;
    if not (app.jt(s -> 'bullets') = 'null' or (app.jt(s -> 'bullets') = 'string' and app.ppt_text_ok(s ->> 'bullets', 1000))) then
      return false;
    end if;
    if not (app.jt(s -> 'notes') = 'null' or (app.jt(s -> 'notes') = 'string' and app.ppt_text_ok(s ->> 'notes', 1000))) then
      return false;
    end if;
    if app.jt(s -> 'assets') <> 'array' or jsonb_array_length(s -> 'assets') > 10 then
      return false;
    end if;
    aids := '{}'::text[];
    for a in select e from jsonb_array_elements(s -> 'assets') e loop
      if app.jt(a) <> 'object' or (select array_agg(k order by k) from jsonb_object_keys(a) k) <> array['asset_id', 'version_no']
         or app.jt(a -> 'asset_id') <> 'string' or (a ->> 'asset_id') !~ uuid_re or (a ->> 'asset_id') = any(aids)
         or app.jt(a -> 'version_no') <> 'number' or (a -> 'version_no')::numeric <> trunc((a -> 'version_no')::numeric)
         or (a -> 'version_no')::numeric < 1 or (a -> 'version_no')::numeric > 1000 then
        return false;
      end if;
      aids := array_append(aids, a ->> 'asset_id');
    end loop;
  end loop;
  return true;
end $$;
revoke execute on function app.ppt_slides_ok(jsonb) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
create table public.ppt_decks (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null,
  project_id            uuid not null,
  production_brief_id   uuid not null,
  source_brief_revision integer not null check (source_brief_revision > 0),
  title                 text not null check (app.ppt_text_ok(title, 120)),
  template_key          text not null check (template_key in ('royal_grid', 'minimal_report', 'brand_deck')),
  status                text not null default 'drafting' check (status in ('drafting', 'reviewed')),
  current_version_no    integer not null check (current_version_no between 1 and 20),
  archived_at           timestamptz,
  revision              integer not null default 1,
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, production_brief_id) references public.production_briefs (project_id, id),
  unique (workspace_id, id),
  unique (project_id, id)
);
create index ppt_decks_brief on public.ppt_decks (production_brief_id, updated_at desc);

create table public.ppt_deck_versions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  deck_id                  uuid not null,
  version_no               integer not null check (version_no between 1 and 20),
  kind                     text not null check (kind in ('create', 'save', 'restore', 'rebase')),
  status                   text not null check (status in ('drafting', 'reviewed')),
  title                    text not null check (app.ppt_text_ok(title, 120)),
  template_key             text not null check (template_key in ('royal_grid', 'minimal_report', 'brand_deck')),
  slides                   jsonb not null check (app.ppt_slides_ok(slides)),
  slide_count              integer not null check (slide_count between 1 and 40),
  source_brief_revision    integer not null check (source_brief_revision > 0),
  restored_from_version_no integer check (restored_from_version_no is null or restored_from_version_no > 0),
  created_by               uuid not null references auth.users (id),
  created_at               timestamptz not null default now(),
  check (slide_count = jsonb_array_length(slides)),
  check ((kind = 'restore') = (restored_from_version_no is not null)),
  foreign key (workspace_id, deck_id) references public.ppt_decks (workspace_id, id),
  unique (deck_id, version_no),
  -- 뒤 단계(P3-f 검수)가 "이 구성안의 판"을 복합 FK 로 가리킬 자리
  unique (deck_id, id)
);

alter table public.ppt_decks
  add constraint ppt_decks_current_version_fkey foreign key (id, current_version_no)
  references public.ppt_deck_versions (deck_id, version_no) deferrable initially deferred;

create trigger ppt_decks_guard before update on public.ppt_decks
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'production_brief_id', 'created_by', 'created_at');

-- 보관한 구성안은 어떤 칸도 바꿀 수 없다(보관 되돌리기 포함, 슈퍼유저 직접 수정도). 내보내기는 읽기라 상관없다
create or replace function app.ppt_deck_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 PPT 구성안은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.ppt_deck_frozen() from public, anon, authenticated;
create trigger ppt_decks_frozen before update on public.ppt_decks
  for each row execute function app.ppt_deck_frozen();

create trigger ppt_deck_versions_append_only before update or delete on public.ppt_deck_versions
  for each row execute function app.reject_mutation();

-- ─────────────────────────────────────────────
-- 2) RLS·권한: select 만 본인 업무실(내보내기도 이 읽기로 한다). 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.ppt_decks         enable row level security;
alter table public.ppt_deck_versions enable row level security;
create policy ppt_decks_select         on public.ppt_decks         for select to authenticated using (app.owns_workspace(workspace_id));
create policy ppt_deck_versions_select on public.ppt_deck_versions for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.ppt_decks, public.ppt_deck_versions from anon;
revoke insert, update, delete, truncate, references, trigger on public.ppt_decks, public.ppt_deck_versions from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미 (정의자 RPC 안에서만)
-- ─────────────────────────────────────────────
create or replace function app.ppt_deck_audit(p_ws uuid, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'ppt_deck', p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.ppt_deck_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

create or replace function app.lock_own_ppt_deck(p_deck_id uuid) returns public.ppt_decks
language plpgsql set search_path = '' as $$
declare
  d public.ppt_decks%rowtype;
begin
  select x.* into d
    from public.ppt_decks x
   where x.id = p_deck_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: PPT 구성안을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return d;
end $$;
revoke execute on function app.lock_own_ppt_deck(uuid) from public, anon, authenticated;

-- 쓸 수 있는지: 구성안 보관 아님 + 프로젝트 보관 아님 + 바탕 전략 작업 취소 아님
create or replace function app.assert_ppt_deck_open(p_deck public.ppt_decks) returns void
language plpgsql stable set search_path = '' as $$
declare
  sa uuid;
begin
  if p_deck.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 PPT 구성안은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  select b.strategy_artifact_id into sa from public.production_briefs b where b.id = p_deck.production_brief_id;
  perform app.assert_production_open(p_deck.project_id, sa);
end $$;
revoke execute on function app.assert_ppt_deck_open(public.ppt_decks) from public, anon, authenticated;

create or replace function app.share_ppt_brief(p_brief_id uuid) returns public.production_briefs
language plpgsql set search_path = '' as $$
declare
  b public.production_briefs%rowtype;
begin
  select x.* into b
    from public.production_briefs x
   where x.id = p_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for share of x;
  if not found then
    raise exception 'NOT_FOUND: 제작 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프로는 PPT 구성안을 만들 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_production_open(b.project_id, b.strategy_artifact_id);
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 확정한 제작 브리프로만 PPT 구성안을 만들 수 있습니다' using errcode = 'P0001';
  end if;
  if not ('ppt_deck' = any(b.deliverable_types)) then
    raise exception 'INVALID_TRANSITION: 이 제작 브리프의 포함 산출물에 PPT 구성이 없습니다' using errcode = 'P0001';
  end if;
  return b;
end $$;
revoke execute on function app.share_ppt_brief(uuid) from public, anon, authenticated;

-- 화면이 보낸 슬라이드 목록 → 저장할 슬라이드 목록. 형식이 틀리면 VALIDATION.
--   입력 슬라이드: {id: 지금 판의 슬라이드 id | null(새 슬라이드), title, bullets, notes, asset_ids: [uuid]}
--   id 는 지금 판(p_prev)에 있는 것만(남의 슬라이드·옛 판에만 있는 id·지어낸 id 거절), null 은 새 uuid.
--   자산은 같은 업무실·같은 프로젝트·보관 안 된 것만 새로 연결. 같은 슬라이드에 이미 있던 자산은 판 번호 유지(보관됐어도).
--   gen_random_uuid 를 쓰므로 VOLATILE(기본)
create or replace function app.ppt_build_slides(p_ws uuid, p_project uuid, p_prev jsonb, p_input jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  prev_ids text[] := '{}'::text[];
  seen     text[] := '{}'::text[];
  out_     jsonb := '[]'::jsonb;
  s        jsonb;
  ps       jsonb;
  sid      text;
  a        jsonb;
  aid      uuid;
  aids     text[];
  assets   jsonb;
  vno      integer;
begin
  if app.jt(p_input) <> 'array' or jsonb_array_length(p_input) < 1 then
    raise exception 'VALIDATION: 슬라이드는 1장 이상이어야 합니다' using errcode = '22023';
  end if;
  if jsonb_array_length(p_input) > 40 then
    raise exception 'VALIDATION: 슬라이드는 40장까지 둘 수 있습니다' using errcode = '22023';
  end if;
  if p_prev is not null then
    select coalesce(array_agg(e ->> 'id'), '{}'::text[]) into prev_ids from jsonb_array_elements(p_prev) e;
  end if;
  for s in select e from jsonb_array_elements(p_input) e loop
    if app.jt(s) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(s) k) <> array['asset_ids', 'bullets', 'id', 'notes', 'title'] then
      raise exception 'VALIDATION: 슬라이드 형식이 올바르지 않습니다' using errcode = '22023';
    end if;
    if app.jt(s -> 'id') = 'null' then
      sid := gen_random_uuid()::text;
      ps := null;
    elsif app.jt(s -> 'id') = 'string' and app.try_uuid(s ->> 'id') is not null and app.try_uuid(s ->> 'id')::text = any(prev_ids) then
      sid := app.try_uuid(s ->> 'id')::text;
      select e into ps from jsonb_array_elements(p_prev) e where e ->> 'id' = sid;
    else
      raise exception 'VALIDATION: 이 구성안에 없는 슬라이드입니다' using errcode = '22023';
    end if;
    if sid = any(seen) then
      raise exception 'VALIDATION: 같은 슬라이드가 두 번 들어 있습니다' using errcode = '22023';
    end if;
    seen := array_append(seen, sid);
    if app.jt(s -> 'title') <> 'string' or not app.ppt_text_ok(s ->> 'title', 100) then
      raise exception 'VALIDATION: 슬라이드 제목은 1~100자로 입력해 주세요(제어 문자 불가)' using errcode = '22023';
    end if;
    if not (app.jt(s -> 'bullets') = 'null' or (app.jt(s -> 'bullets') = 'string' and app.ppt_text_ok(s ->> 'bullets', 1000))) then
      raise exception 'VALIDATION: 핵심 요점은 1,000자까지입니다(제어 문자 불가)' using errcode = '22023';
    end if;
    if not (app.jt(s -> 'notes') = 'null' or (app.jt(s -> 'notes') = 'string' and app.ppt_text_ok(s ->> 'notes', 1000))) then
      raise exception 'VALIDATION: 발표자 메모는 1,000자까지입니다(제어 문자 불가)' using errcode = '22023';
    end if;
    if app.jt(s -> 'asset_ids') <> 'array' then
      raise exception 'VALIDATION: 사용 디자인 자산 형식이 올바르지 않습니다' using errcode = '22023';
    end if;
    if jsonb_array_length(s -> 'asset_ids') > 10 then
      raise exception 'VALIDATION: 슬라이드 하나에 디자인 자산은 10개까지 연결할 수 있습니다' using errcode = '22023';
    end if;
    aids := '{}'::text[];
    assets := '[]'::jsonb;
    for a in select e from jsonb_array_elements(s -> 'asset_ids') e loop
      aid := case when app.jt(a) = 'string' then app.try_uuid(a #>> '{}') end;
      if aid is null then
        raise exception 'VALIDATION: 사용 디자인 자산 형식이 올바르지 않습니다' using errcode = '22023';
      end if;
      if aid::text = any(aids) then
        raise exception 'VALIDATION: 같은 디자인 자산이 두 번 들어 있습니다' using errcode = '22023';
      end if;
      aids := array_append(aids, aid::text);
      vno := null;
      if ps is not null then
        select (x ->> 'version_no')::integer into vno from jsonb_array_elements(ps -> 'assets') x where x ->> 'asset_id' = aid::text;
      end if;
      -- 다른 슬라이드에서 옮겨 온 자산(또는 빼고 새 슬라이드에 넣은 자산)도 직전 판 전체에서 같은 자산의 판 번호를 유지한다(여럿이면 가장 낮은 판).
      --   저장만으로 이전 기준이 풀리지 않게 — 푸는 길은 맞추기뿐(P3DE-BACKEND-FIX-01, Tester QA-P3E-PREP-01 D1).
      --   보관된 자산은 여기서 이어받지 않는다: 같은 슬라이드에 그대로 있으면 위에서 유지되고, 다른 슬라이드로 옮기거나 더 넣는 것은 새 연결이라 아래에서 거절(기존 규칙)
      if vno is null and p_prev is not null
         and exists (select 1 from public.design_assets x where x.id = aid and x.workspace_id = p_ws and x.project_id = p_project and x.archived_at is null) then
        select min((x ->> 'version_no')::integer) into vno from jsonb_array_elements(p_prev) e, jsonb_array_elements(e -> 'assets') x
         where x ->> 'asset_id' = aid::text;
      end if;
      if vno is null then
        select x.current_version_no into vno from public.design_assets x
         where x.id = aid and x.workspace_id = p_ws and x.project_id = p_project and x.archived_at is null;
        if vno is null then
          raise exception 'VALIDATION: 같은 프로젝트의 보관하지 않은 디자인 자산만 연결할 수 있습니다' using errcode = '22023';
        end if;
      end if;
      assets := assets || jsonb_build_array(jsonb_build_object('asset_id', aid::text, 'version_no', vno));
    end loop;
    out_ := out_ || jsonb_build_array(jsonb_build_object('id', sid, 'title', s ->> 'title', 'bullets', s -> 'bullets', 'notes', s -> 'notes', 'assets', assets));
  end loop;
  return out_;
end $$;
revoke execute on function app.ppt_build_slides(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- 새 판 넣기 + 머리 행 바꾸기(판 20 한도). 감사는 부른 쪽이 남긴다
create or replace function app.ppt_deck_add_version(p_deck public.ppt_decks, p_kind text, p_status text, p_title text, p_template text,
                                                     p_slides jsonb, p_brief_revision integer, p_restored_from integer) returns integer
language plpgsql set search_path = '' as $$
declare
  n integer := p_deck.current_version_no + 1;
  r integer;
begin
  if n > 20 then
    raise exception 'LIMIT_REACHED: PPT 구성안 판 이력이 20개에 도달해 더 저장하거나 되돌릴 수 없습니다. 보관한 뒤 새 구성안으로 만들어 주세요' using errcode = 'P0001';
  end if;
  insert into public.ppt_deck_versions (workspace_id, deck_id, version_no, kind, status, title, template_key, slides, slide_count,
                                        source_brief_revision, restored_from_version_no, created_by)
  values (p_deck.workspace_id, p_deck.id, n, p_kind, p_status, p_title, p_template, p_slides, jsonb_array_length(p_slides),
          p_brief_revision, p_restored_from, auth.uid());
  update public.ppt_decks set current_version_no = n, status = p_status, title = p_title, template_key = p_template,
                              source_brief_revision = p_brief_revision
   where id = p_deck.id returning revision into r;
  return r;
end $$;
revoke execute on function app.ppt_deck_add_version(public.ppt_decks, text, text, text, text, jsonb, integer, integer) from public, anon, authenticated;

create or replace function app.ppt_deck_current(p_deck public.ppt_decks) returns public.ppt_deck_versions
language sql stable set search_path = '' as $$
  select v.* from public.ppt_deck_versions v where v.deck_id = p_deck.id and v.version_no = p_deck.current_version_no
$$;
revoke execute on function app.ppt_deck_current(public.ppt_decks) from public, anon, authenticated;

create or replace function app.assert_ppt_deck_fields(p_title text, p_template text, p_status text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if not app.ppt_text_ok(p_title, 120) then
    raise exception 'VALIDATION: 발표 자료 제목은 1~120자로 입력해 주세요(제어 문자 불가)' using errcode = '22023';
  end if;
  if p_template is null or p_template not in ('royal_grid', 'minimal_report', 'brand_deck') then
    raise exception 'VALIDATION: 알 수 없는 템플릿입니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('drafting', 'reviewed') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
end $$;
revoke execute on function app.assert_ppt_deck_fields(text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 만들기(슬라이드 함께 — 기본 뼈대 3장은 화면이 채워 보낸다). 브리프당 보관 안 된 것 5·전체 10
create or replace function public.create_ppt_deck(p_production_brief_id uuid, p_title text, p_template_key text, p_slides jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  b    public.production_briefs%rowtype;
  sl   jsonb;
  d_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.share_ppt_brief(p_production_brief_id);
  perform app.assert_ppt_deck_fields(p_title, p_template_key, 'drafting');
  sl := app.ppt_build_slides(b.workspace_id, b.project_id, null, p_slides);
  perform pg_advisory_xact_lock(34001, hashtext(b.id::text)); -- 이름공간 34001(브리프 PPT 구성안 수) + 브리프
  if (select count(*) from public.ppt_decks x where x.production_brief_id = b.id) >= 10 then
    raise exception 'LIMIT_REACHED: PPT 구성안은 브리프당 활성 5개(전체 10개)까지 둘 수 있습니다' using errcode = 'P0001';
  end if;
  if (select count(*) from public.ppt_decks x where x.production_brief_id = b.id and x.archived_at is null) >= 5 then
    raise exception 'LIMIT_REACHED: PPT 구성안은 브리프당 활성 5개(전체 10개)까지 둘 수 있습니다' using errcode = 'P0001';
  end if;
  insert into public.ppt_decks (workspace_id, project_id, production_brief_id, source_brief_revision, title, template_key, status,
                                current_version_no, created_by)
  values (b.workspace_id, b.project_id, b.id, b.revision, p_title, p_template_key, 'drafting', 1, uid)
  returning id into d_id;
  insert into public.ppt_deck_versions (workspace_id, deck_id, version_no, kind, status, title, template_key, slides, slide_count,
                                        source_brief_revision, created_by)
  values (b.workspace_id, d_id, 1, 'create', 'drafting', p_title, p_template_key, sl, jsonb_array_length(sl), b.revision, uid);
  perform app.ppt_deck_audit(b.workspace_id, d_id, 'ppt_deck_create', 1,
                             jsonb_build_object('production_brief_id', b.id, 'brief_revision', b.revision, 'version_no', 1,
                                                'slide_count', jsonb_array_length(sl), 'template_key', p_template_key));
  return d_id;
end $$;
revoke execute on function public.create_ppt_deck(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_ppt_deck(uuid, text, text, jsonb) to authenticated;

-- 4-2) 저장 = 새 판(save). 바뀐 게 없으면 거절
create or replace function public.save_ppt_deck(p_deck_id uuid, p_expected_revision integer, p_title text, p_template_key text,
                                                p_status text, p_slides jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d   public.ppt_decks%rowtype;
  cur public.ppt_deck_versions%rowtype;
  sl  jsonb;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_ppt_deck(p_deck_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_ppt_deck_open(d);
  perform app.assert_ppt_deck_fields(p_title, p_template_key, p_status);
  cur := app.ppt_deck_current(d);
  sl := app.ppt_build_slides(d.workspace_id, d.project_id, cur.slides, p_slides);
  if p_title = cur.title and p_template_key = cur.template_key and p_status = cur.status and sl = cur.slides then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  r := app.ppt_deck_add_version(d, 'save', p_status, p_title, p_template_key, sl, d.source_brief_revision, null);
  perform app.ppt_deck_audit(d.workspace_id, d.id, 'ppt_deck_save', r,
                             jsonb_build_object('version_no', d.current_version_no + 1, 'status', p_status, 'template_key', p_template_key,
                                                'slide_count', jsonb_array_length(sl)));
  return r;
end $$;
revoke execute on function public.save_ppt_deck(uuid, integer, text, text, text, jsonb) from public, anon;
grant execute on function public.save_ppt_deck(uuid, integer, text, text, text, jsonb) to authenticated;

-- 4-3) 되돌리기: 고른 판의 제목·템플릿·슬라이드(슬라이드 id·연결 자산 판 번호 그대로)로 새 판. 진행 상태는 지금 값. 같으면 거절
create or replace function public.restore_ppt_deck_version(p_deck_id uuid, p_expected_revision integer, p_version_no integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d   public.ppt_decks%rowtype;
  cur public.ppt_deck_versions%rowtype;
  v   public.ppt_deck_versions%rowtype;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_ppt_deck(p_deck_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_ppt_deck_open(d);
  select x.* into v from public.ppt_deck_versions x where x.deck_id = d.id and x.version_no = p_version_no;
  if not found then
    raise exception 'NOT_FOUND: 그 판을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  cur := app.ppt_deck_current(d);
  if v.title = cur.title and v.template_key = cur.template_key and v.slides = cur.slides then
    raise exception 'VALIDATION: 지금 구성안과 같은 판입니다' using errcode = '22023';
  end if;
  r := app.ppt_deck_add_version(d, 'restore', d.status, v.title, v.template_key, v.slides, d.source_brief_revision, v.version_no);
  perform app.ppt_deck_audit(d.workspace_id, d.id, 'ppt_deck_restore', r,
                             jsonb_build_object('version_no', d.current_version_no + 1, 'restored_from_version_no', v.version_no,
                                                'slide_count', v.slide_count));
  return r;
end $$;
revoke execute on function public.restore_ppt_deck_version(uuid, integer, integer) from public, anon;
grant execute on function public.restore_ppt_deck_version(uuid, integer, integer) to authenticated;

-- 4-4) 맞추기: 브리프 revision 과 슬라이드 자산 판 번호를 지금 값으로(브리프가 확정·보관 안 됨일 때만). 바뀔 게 없으면 거절
create or replace function public.rebase_ppt_deck(p_deck_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d   public.ppt_decks%rowtype;
  b   public.production_briefs%rowtype;
  cur public.ppt_deck_versions%rowtype;
  sl  jsonb;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_ppt_deck(p_deck_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_ppt_deck_open(d);
  select x.* into b from public.production_briefs x where x.id = d.production_brief_id;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 바탕 제작 브리프가 보관되어 최신 기준으로 맞출 수 없습니다' using errcode = 'P0001';
  end if;
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 바탕 제작 브리프가 아직 확정 전이라 최신 기준으로 맞출 수 없습니다' using errcode = 'P0001';
  end if;
  cur := app.ppt_deck_current(d);
  select jsonb_agg(jsonb_set(s, '{assets}', coalesce((
           select jsonb_agg(jsonb_build_object('asset_id', a ->> 'asset_id', 'version_no', da.current_version_no) order by o2)
             from jsonb_array_elements(s -> 'assets') with ordinality as t2(a, o2)
             join public.design_assets da on da.id = (a ->> 'asset_id')::uuid), '[]'::jsonb)) order by o)
    into sl
    from jsonb_array_elements(cur.slides) with ordinality as t(s, o);
  if b.revision = d.source_brief_revision and sl = cur.slides then
    raise exception 'VALIDATION: 이미 지금 제작 브리프·디자인 자산 기준입니다' using errcode = '22023';
  end if;
  r := app.ppt_deck_add_version(d, 'rebase', d.status, cur.title, cur.template_key, sl, b.revision, null);
  perform app.ppt_deck_audit(d.workspace_id, d.id, 'ppt_deck_rebase', r,
                             jsonb_build_object('from_brief_revision', d.source_brief_revision, 'to_brief_revision', b.revision,
                                                'version_no', d.current_version_no + 1));
  return r;
end $$;
revoke execute on function public.rebase_ppt_deck(uuid, integer) from public, anon;
grant execute on function public.rebase_ppt_deck(uuid, integer) to authenticated;

-- 4-5) 보관(삭제 대신, 되돌리기 없음). 보관해도 내보내기(읽기)는 된다
create or replace function public.archive_ppt_deck(p_deck_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.ppt_decks%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_ppt_deck(p_deck_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if d.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 PPT 구성안입니다' using errcode = 'P0001';
  end if;
  perform app.assert_ppt_deck_open(d);
  update public.ppt_decks set archived_at = now() where id = d.id returning revision into r;
  perform app.ppt_deck_audit(d.workspace_id, d.id, 'ppt_deck_archive', r,
                             jsonb_build_object('version_no', d.current_version_no, 'status', d.status));
  return r;
end $$;
revoke execute on function public.archive_ppt_deck(uuid, integer) from public, anon;
grant execute on function public.archive_ppt_deck(uuid, integer) to authenticated;
