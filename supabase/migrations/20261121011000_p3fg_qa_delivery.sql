-- P3FG-BACKEND-IMPL-01 검수 체크리스트(P3-f)·납품 묶음(P3-g) 서버. 설계: Plan/Claude-Backend-20261120/P3FG-BACKEND-01-DESIGN.md (Master 수락, 8절 결정)
-- 검수: 산출물(홈페이지 문서·디자인 자산 하나·영상 구성안·PPT 구성안) 하나마다 회차 1~30. 회차는 그 산출물의 특정 판을 복합 FK 로 가리킨다
--   (판 표의 unique(부모, id) — 종류별 칸 한 쌍만 채운다). 열린 회차(drafting·fix_requested)는 산출물당 하나. 항목 1~30(기본 필수 4개는 AGY 상수).
--   승인(reviewed) 게이트는 DB: 필수 항목 모두 passed + 대상 판이 아직 현재 판 + 산출물 보관 안 됨. 보완 요청은 회차 상태만 바꾼다(산출물 표는 안 건드림).
-- 납품: 서버가 산출물별 최근 승인 회차의 판 + 확정 브리프 현재 revision 을 모아 바꿀 수 없는 묶음(프로젝트당 50, 항목 100)을 만든다.
--   항목은 추가 전용 표(delivery_bundle_items, unique(bundle_id, id), content_sha256) — P4 실행 대기열(source_kind 'delivery_bundle_item')이 가리킬 자리.
--   전달 기록 추가 전용(묶음당 50). 보관 뒤에도 새 묶음 가능. 외부 발송·AI 호출 0(X11).
-- 바뀌지 않는 것: 기존 표·RPC(산출물 표는 읽기만, FOR SHARE 잠금만). P4A 표도 그대로(분기는 P4 다음 단계, Master ⑧).
-- 잠금: 회차 열기·재검수는 산출물 행 FOR SHARE → advisory(35001, 산출물). 승인은 회차 행 FOR UPDATE → 산출물 행 FOR SHARE.
--   산출물 저장 RPC 는 산출물 행 FOR UPDATE 만 잡고 회차를 잡지 않으므로 반대 방향이 없다. 묶음 만들기·복구는 advisory(35002, 프로젝트).

-- ─────────────────────────────────────────────
-- 0) 산출물 읽기 도우미(종류 4개를 한 모양으로)
-- ─────────────────────────────────────────────
create type app.qa_target as (
  kind         text,
  target_id    uuid,
  workspace_id uuid,
  project_id   uuid,
  brief_id     uuid,
  version_id   uuid,
  version_no   integer,
  reviewed     boolean,
  archived     boolean
);

-- 본인 업무실의 산출물 하나를 현재 판과 함께 읽는다(p_lock 이면 산출물 행 FOR SHARE). 없거나 남의 것이면 null
create or replace function app.qa_target_of(p_kind text, p_id uuid, p_lock boolean) returns app.qa_target
language plpgsql set search_path = '' as $$
declare
  t app.qa_target;
begin
  if p_kind = 'web_copy' then
    select 'web_copy', d.id, d.workspace_id, d.project_id, d.production_brief_id, v.id, v.version_no, v.status = 'reviewed', d.archived_at is not null
      into t from public.web_copy_docs d join public.web_copy_versions v on v.doc_id = d.id and v.version_no = d.current_version_no
     where d.id = p_id and exists (select 1 from public.workspaces w where w.id = d.workspace_id and w.owner_user_id = auth.uid());
    if found and p_lock then perform 1 from public.web_copy_docs x where x.id = p_id for share; end if;
  elsif p_kind = 'design_assets' then
    select 'design_assets', a.id, a.workspace_id, a.project_id, a.production_brief_id, v.id, v.version_no, a.status = 'reviewed', a.archived_at is not null
      into t from public.design_assets a join public.design_asset_versions v on v.asset_id = a.id and v.version_no = a.current_version_no
     where a.id = p_id and exists (select 1 from public.workspaces w where w.id = a.workspace_id and w.owner_user_id = auth.uid());
    if found and p_lock then perform 1 from public.design_assets x where x.id = p_id for share; end if;
  elsif p_kind = 'video_plan' then
    select 'video_plan', p.id, p.workspace_id, p.project_id, p.production_brief_id, v.id, v.version_no, v.status = 'reviewed', p.archived_at is not null
      into t from public.video_plans p join public.video_plan_versions v on v.plan_id = p.id and v.version_no = p.current_version_no
     where p.id = p_id and exists (select 1 from public.workspaces w where w.id = p.workspace_id and w.owner_user_id = auth.uid());
    if found and p_lock then perform 1 from public.video_plans x where x.id = p_id for share; end if;
  elsif p_kind = 'ppt_deck' then
    select 'ppt_deck', d.id, d.workspace_id, d.project_id, d.production_brief_id, v.id, v.version_no, v.status = 'reviewed', d.archived_at is not null
      into t from public.ppt_decks d join public.ppt_deck_versions v on v.deck_id = d.id and v.version_no = d.current_version_no
     where d.id = p_id and exists (select 1 from public.workspaces w where w.id = d.workspace_id and w.owner_user_id = auth.uid());
    if found and p_lock then perform 1 from public.ppt_decks x where x.id = p_id for share; end if;
  else
    raise exception 'VALIDATION: 알 수 없는 검수 대상 종류입니다' using errcode = '22023';
  end if;
  return t;
end $$;
revoke execute on function app.qa_target_of(text, uuid, boolean) from public, anon, authenticated;

-- 판 하나의 내용 지문(sha256 hex). 납품 항목·P4 실행 지문(source_hash)으로 쓴다. 파일 자산은 판에 적힌 파일 sha256
create or replace function app.qa_version_sha(p_kind text, p_version_id uuid) returns text
language sql stable set search_path = '' as $$
  select case p_kind
    when 'web_copy' then (select encode(sha256(convert_to(v.content::text, 'UTF8')), 'hex') from public.web_copy_versions v where v.id = p_version_id)
    when 'design_assets' then (select v.sha256 from public.design_asset_versions v where v.id = p_version_id)
    when 'video_plan' then (select encode(sha256(convert_to(jsonb_build_object('title', v.title, 'aspect_ratio', v.aspect_ratio, 'status', v.status, 'scenes', v.scenes)::text, 'UTF8')), 'hex')
                              from public.video_plan_versions v where v.id = p_version_id)
    when 'ppt_deck' then (select encode(sha256(convert_to(jsonb_build_object('title', v.title, 'template_key', v.template_key, 'status', v.status, 'slides', v.slides)::text, 'UTF8')), 'hex')
                            from public.ppt_deck_versions v where v.id = p_version_id)
  end
$$;
revoke execute on function app.qa_version_sha(text, uuid) from public, anon, authenticated;

-- 산출물이 속한 프로젝트·전략 작업이 열려 있는지(보관·취소면 INVALID_TRANSITION)
create or replace function app.assert_qa_open(t app.qa_target) returns void
language plpgsql stable set search_path = '' as $$
declare
  sa uuid;
begin
  select b.strategy_artifact_id into sa from public.production_briefs b where b.id = t.brief_id;
  perform app.assert_production_open(t.project_id, sa);
end $$;
revoke execute on function app.assert_qa_open(app.qa_target) from public, anon, authenticated;

-- 종류별 기본 필수 검수 항목(AGY P3F-HANDOFF.md 4절 DEFAULT_QA_ITEMS, 앱 상수와 같은 글 — 시험이 대조)
create or replace function app.qa_default_items(p_kind text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'web_copy' then array[
      '페이지 제목과 핵심 안내 문구가 공통 제작 브리프와 맞는지 확인',
      '모든 연결 근거 출처가 유효하고 과장·약속 표현이 없는지 확인',
      '이동 경로(/slug)와 행동 유도 문구가 누락 없이 이어지는지 확인',
      '맞춤법과 어색한 번역투 문장이 없는지 확인']
    when 'design_assets' then array[
      '자산 파일이 열리고 깨짐이나 누락이 없는지 확인',
      '공통 제작 브리프의 톤과 디자인 토큰 색상 기준에 맞는지 확인',
      'SVG·이미지 파일에 불필요한 외부 연결이나 위험 요소가 없는지 확인',
      '사용처 연결과 파일 설명이 실제 산출물과 맞는지 확인']
    when 'video_plan' then array[
      '장면 순서·대사·자막이 공통 제작 브리프 내용과 맞는지 확인',
      '화면 비율과 각 장면 길이(1~600초)가 제작 기준에 맞는지 확인',
      '첨부된 최종 영상 파일이 재생되고 자막 오탈자가 없는지 확인',
      '연결된 디자인 자산이 최신 판이고 보관된 자산이 아닌지 확인']
    when 'ppt_deck' then array[
      '표지·목차·본문 슬라이드 구성이 공통 제작 브리프와 맞는지 확인',
      '요점과 발표자 메모에 자리 표시([직접 입력: …])가 남아 있지 않은지 확인',
      '내보낸 .pptx·.md 파일이 정상으로 열리고 글자가 깨지지 않는지 확인',
      '연결된 디자인 자산이 최신 판이고 보관된 자산이 아닌지 확인']
  end
$$;
revoke execute on function app.qa_default_items(text) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 검수 표
-- ─────────────────────────────────────────────
create table public.qa_reviews (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null,
  project_id              uuid not null,
  target_kind             text not null check (target_kind in ('web_copy', 'design_assets', 'video_plan', 'ppt_deck')),
  web_copy_doc_id         uuid,
  web_copy_version_id     uuid,
  design_asset_id         uuid,
  design_asset_version_id uuid,
  video_plan_id           uuid,
  video_plan_version_id   uuid,
  ppt_deck_id             uuid,
  ppt_deck_version_id     uuid,
  -- 검수 대상 산출물 id(종류와 상관없이 한 칸, 회차·열린 회차 unique 용)
  target_id               uuid generated always as (coalesce(web_copy_doc_id, design_asset_id, video_plan_id, ppt_deck_id)) stored,
  target_version_no       integer not null check (target_version_no >= 1),
  round_no                integer not null check (round_no between 1 and 30),
  status                  text not null default 'drafting' check (status in ('drafting', 'fix_requested', 'reviewed')),
  approved_at             timestamptz,
  approved_by             uuid references auth.users (id),
  archived_at             timestamptz,
  revision                integer not null default 1,
  created_by              uuid not null references auth.users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- 종류와 맞는 한 쌍(부모 id + 판 id)만 채운다
  check (num_nonnulls(web_copy_doc_id, design_asset_id, video_plan_id, ppt_deck_id) = 1),
  check ((web_copy_doc_id is null) = (web_copy_version_id is null) and (design_asset_id is null) = (design_asset_version_id is null)
         and (video_plan_id is null) = (video_plan_version_id is null) and (ppt_deck_id is null) = (ppt_deck_version_id is null)),
  check ((target_kind = 'web_copy') = (web_copy_doc_id is not null) and (target_kind = 'design_assets') = (design_asset_id is not null)
         and (target_kind = 'video_plan') = (video_plan_id is not null) and (target_kind = 'ppt_deck') = (ppt_deck_id is not null)),
  check ((status = 'reviewed') = (approved_at is not null) and (approved_at is null) = (approved_by is null)),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  -- 대상 산출물은 같은 프로젝트, 판은 그 산출물의 판(판 표의 unique(부모, id))
  foreign key (project_id, web_copy_doc_id) references public.web_copy_docs (project_id, id),
  foreign key (web_copy_doc_id, web_copy_version_id) references public.web_copy_versions (doc_id, id),
  foreign key (project_id, design_asset_id) references public.design_assets (project_id, id),
  foreign key (design_asset_id, design_asset_version_id) references public.design_asset_versions (asset_id, id),
  foreign key (project_id, video_plan_id) references public.video_plans (project_id, id),
  foreign key (video_plan_id, video_plan_version_id) references public.video_plan_versions (plan_id, id),
  foreign key (project_id, ppt_deck_id) references public.ppt_decks (project_id, id),
  foreign key (ppt_deck_id, ppt_deck_version_id) references public.ppt_deck_versions (deck_id, id),
  unique (target_id, round_no),
  unique (workspace_id, id),
  unique (project_id, id)
);
-- 열린 회차는 산출물당 하나(동시 열기는 RPC 가 advisory 로 먼저 거른다)
create unique index qa_reviews_one_open on public.qa_reviews (target_id) where status in ('drafting', 'fix_requested') and archived_at is null;
create index qa_reviews_project on public.qa_reviews (project_id, target_kind, target_id, round_no desc);

create table public.qa_check_items (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  review_id   uuid not null,
  sort_order  integer not null check (sort_order between 1 and 30),
  item_title  text not null check (app.ppt_text_ok(item_title, 120)),
  is_required boolean not null default true,
  is_default  boolean not null default false,
  verdict     text not null default 'pending' check (verdict in ('pending', 'passed', 'needs_fix')),
  memo        text check (memo is null or app.ppt_text_ok(memo, 500)),
  checked_by  uuid references auth.users (id),
  checked_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (verdict <> 'needs_fix' or memo is not null),
  check ((verdict = 'pending') = (checked_by is null) and (checked_by is null) = (checked_at is null)),
  check (not is_default or is_required),
  foreign key (workspace_id, review_id) references public.qa_reviews (workspace_id, id)
);
create index qa_check_items_review on public.qa_check_items (review_id, sort_order);

create trigger qa_reviews_guard before update on public.qa_reviews
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'target_kind', 'web_copy_doc_id', 'web_copy_version_id',
    'design_asset_id', 'design_asset_version_id', 'video_plan_id', 'video_plan_version_id', 'ppt_deck_id', 'ppt_deck_version_id',
    'target_version_no', 'round_no', 'created_by', 'created_at');

-- 보관한 회차는 어떤 칸도 못 바꾼다. 승인(reviewed)한 회차는 보관만 된다(승인 되돌리기 없음, 슈퍼유저 직접 수정도)
create or replace function app.qa_review_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 검수 회차는 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  if old.status = 'reviewed' and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'FROZEN_COLUMN: 승인한 검수 회차는 되돌릴 수 없습니다. 새 회차로 다시 검수해 주세요' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.qa_review_frozen() from public, anon, authenticated;
create trigger qa_reviews_frozen before update on public.qa_reviews
  for each row execute function app.qa_review_frozen();

-- 항목은 열린 회차(drafting·fix_requested, 보관 안 됨)에서만 넣고·고치고·뺀다
create or replace function app.qa_items_open() returns trigger
language plpgsql set search_path = '' as $$
declare
  rid uuid := case when tg_op = 'DELETE' then old.review_id else new.review_id end;
begin
  if tg_op = 'UPDATE' and new.review_id is distinct from old.review_id then
    raise exception 'FROZEN_COLUMN: 검수 항목의 회차는 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.qa_reviews r where r.id = rid and r.status in ('drafting', 'fix_requested') and r.archived_at is null) then
    raise exception 'FROZEN_COLUMN: 닫히거나 보관한 검수 회차의 항목은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function app.qa_items_open() from public, anon, authenticated;
create trigger qa_check_items_open before insert or update or delete on public.qa_check_items
  for each row execute function app.qa_items_open();

-- ─────────────────────────────────────────────
-- 2) 납품 표
-- ─────────────────────────────────────────────
create table public.delivery_bundles (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  project_id       uuid not null,
  bundle_no        integer not null check (bundle_no between 1 and 50),
  status           text not null default 'drafting' check (status in ('drafting', 'reviewed')),
  restored_from_id uuid,
  item_count       integer not null check (item_count between 1 and 100),
  archived_at      timestamptz,
  revision         integer not null default 1,
  created_by       uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, restored_from_id) references public.delivery_bundles (project_id, id),
  unique (project_id, bundle_no),
  unique (workspace_id, id),
  unique (project_id, id)
);

create table public.delivery_bundle_items (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null,
  project_id              uuid not null,
  bundle_id               uuid not null,
  sort_order              integer not null check (sort_order between 1 and 100),
  kind                    text not null check (kind in ('production_brief', 'web_copy', 'design_assets', 'video_plan', 'ppt_deck')),
  production_brief_id     uuid,
  brief_revision          integer check (brief_revision is null or brief_revision >= 1),
  web_copy_doc_id         uuid,
  web_copy_version_id     uuid,
  design_asset_id         uuid,
  design_asset_version_id uuid,
  video_plan_id           uuid,
  video_plan_version_id   uuid,
  ppt_deck_id             uuid,
  ppt_deck_version_id     uuid,
  version_no              integer not null check (version_no >= 1),
  qa_review_id            uuid,
  content_sha256          text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at              timestamptz not null default now(),
  check (num_nonnulls(production_brief_id, web_copy_doc_id, design_asset_id, video_plan_id, ppt_deck_id) = 1),
  check ((web_copy_doc_id is null) = (web_copy_version_id is null) and (design_asset_id is null) = (design_asset_version_id is null)
         and (video_plan_id is null) = (video_plan_version_id is null) and (ppt_deck_id is null) = (ppt_deck_version_id is null)),
  check ((kind = 'production_brief') = (production_brief_id is not null) and (kind = 'web_copy') = (web_copy_doc_id is not null)
         and (kind = 'design_assets') = (design_asset_id is not null) and (kind = 'video_plan') = (video_plan_id is not null) and (kind = 'ppt_deck') = (ppt_deck_id is not null)),
  -- 검수 대상이면 승인 회차가 있고, 브리프면 revision 이 있다
  check ((kind = 'production_brief') = (qa_review_id is null) and (kind = 'production_brief') = (brief_revision is not null)),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, bundle_id) references public.delivery_bundles (project_id, id),
  foreign key (project_id, production_brief_id) references public.production_briefs (project_id, id),
  foreign key (project_id, web_copy_doc_id) references public.web_copy_docs (project_id, id),
  foreign key (web_copy_doc_id, web_copy_version_id) references public.web_copy_versions (doc_id, id),
  foreign key (project_id, design_asset_id) references public.design_assets (project_id, id),
  foreign key (design_asset_id, design_asset_version_id) references public.design_asset_versions (asset_id, id),
  foreign key (project_id, video_plan_id) references public.video_plans (project_id, id),
  foreign key (video_plan_id, video_plan_version_id) references public.video_plan_versions (plan_id, id),
  foreign key (project_id, ppt_deck_id) references public.ppt_decks (project_id, id),
  foreign key (ppt_deck_id, ppt_deck_version_id) references public.ppt_deck_versions (deck_id, id),
  foreign key (project_id, qa_review_id) references public.qa_reviews (project_id, id),
  unique (bundle_id, sort_order),
  -- 뒤 단계(P4 실행 대기열 source_kind 'delivery_bundle_item')가 복합 FK 로 가리킬 자리
  unique (bundle_id, id),
  unique (workspace_id, id)
);

create table public.delivery_logs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  bundle_id    uuid not null,
  method       text not null check (method in ('email', 'cloud_link', 'messenger', 'in_person')),
  delivered_at timestamptz not null check (delivered_at >= timestamptz '2000-01-01 00:00:00+09'),
  note         text check (note is null or app.ppt_text_ok(note, 300)),
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  foreign key (workspace_id, bundle_id) references public.delivery_bundles (workspace_id, id)
);
create index delivery_logs_bundle on public.delivery_logs (bundle_id, delivered_at desc);

create trigger delivery_bundles_guard before update on public.delivery_bundles
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'bundle_no', 'restored_from_id', 'item_count', 'created_by', 'created_at');
create or replace function app.delivery_bundle_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 납품 묶음은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.delivery_bundle_frozen() from public, anon, authenticated;
create trigger delivery_bundles_frozen before update on public.delivery_bundles
  for each row execute function app.delivery_bundle_frozen();
create trigger delivery_bundle_items_append_only before update or delete on public.delivery_bundle_items
  for each row execute function app.reject_mutation();
create trigger delivery_logs_append_only before update or delete on public.delivery_logs
  for each row execute function app.reject_mutation();

-- ─────────────────────────────────────────────
-- 3) RLS·권한: select 만 본인 업무실, 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.qa_reviews            enable row level security;
alter table public.qa_check_items        enable row level security;
alter table public.delivery_bundles      enable row level security;
alter table public.delivery_bundle_items enable row level security;
alter table public.delivery_logs         enable row level security;
create policy qa_reviews_select            on public.qa_reviews            for select to authenticated using (app.owns_workspace(workspace_id));
create policy qa_check_items_select        on public.qa_check_items        for select to authenticated using (app.owns_workspace(workspace_id));
create policy delivery_bundles_select      on public.delivery_bundles      for select to authenticated using (app.owns_workspace(workspace_id));
create policy delivery_bundle_items_select on public.delivery_bundle_items for select to authenticated using (app.owns_workspace(workspace_id));
create policy delivery_logs_select         on public.delivery_logs         for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.qa_reviews, public.qa_check_items, public.delivery_bundles, public.delivery_bundle_items, public.delivery_logs from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.qa_reviews, public.qa_check_items, public.delivery_bundles, public.delivery_bundle_items, public.delivery_logs from authenticated;

-- ─────────────────────────────────────────────
-- 4) 도우미
-- ─────────────────────────────────────────────
create or replace function app.qa_audit(p_ws uuid, p_type text, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, p_type, p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.qa_audit(uuid, text, uuid, text, integer, jsonb) from public, anon, authenticated;

create or replace function app.lock_own_qa_review(p_id uuid) returns public.qa_reviews
language plpgsql set search_path = '' as $$
declare
  r public.qa_reviews%rowtype;
begin
  select x.* into r from public.qa_reviews x
   where x.id = p_id and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
   for update of x;
  if not found then
    raise exception 'NOT_FOUND: 검수 회차를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return r;
end $$;
revoke execute on function app.lock_own_qa_review(uuid) from public, anon, authenticated;

-- 열린(작업할 수 있는) 회차인지 + revision
create or replace function app.assert_qa_review_open(r public.qa_reviews, p_expected_revision integer) returns void
language plpgsql stable set search_path = '' as $$
begin
  if r.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if r.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 검수 회차는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  if r.status = 'reviewed' then
    raise exception 'INVALID_TRANSITION: 승인한 검수 회차는 고칠 수 없습니다. 새 회차로 다시 검수해 주세요' using errcode = 'P0001';
  end if;
end $$;
revoke execute on function app.assert_qa_review_open(public.qa_reviews, integer) from public, anon, authenticated;

create or replace function app.qa_review_target(r public.qa_reviews) returns uuid
language sql immutable set search_path = '' as $$
  select coalesce(r.web_copy_version_id, r.design_asset_version_id, r.video_plan_version_id, r.ppt_deck_version_id)
$$;
revoke execute on function app.qa_review_target(public.qa_reviews) from public, anon, authenticated;

-- 새 회차 넣기(기본 항목 또는 앞 회차 항목을 pending 으로 옮김)
create or replace function app.qa_insert_round(t app.qa_target, p_round integer, p_copy_from uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  rid uuid := gen_random_uuid();
  titles text[] := app.qa_default_items(t.kind);
begin
  insert into public.qa_reviews (id, workspace_id, project_id, target_kind,
                                 web_copy_doc_id, web_copy_version_id, design_asset_id, design_asset_version_id,
                                 video_plan_id, video_plan_version_id, ppt_deck_id, ppt_deck_version_id,
                                 target_version_no, round_no, created_by)
  values (rid, t.workspace_id, t.project_id, t.kind,
          case when t.kind = 'web_copy' then t.target_id end, case when t.kind = 'web_copy' then t.version_id end,
          case when t.kind = 'design_assets' then t.target_id end, case when t.kind = 'design_assets' then t.version_id end,
          case when t.kind = 'video_plan' then t.target_id end, case when t.kind = 'video_plan' then t.version_id end,
          case when t.kind = 'ppt_deck' then t.target_id end, case when t.kind = 'ppt_deck' then t.version_id end,
          t.version_no, p_round, auth.uid());
  if p_copy_from is null then
    for i in 1 .. cardinality(titles) loop
      insert into public.qa_check_items (workspace_id, review_id, sort_order, item_title, is_required, is_default)
      values (t.workspace_id, rid, i, titles[i], true, true);
    end loop;
  else
    insert into public.qa_check_items (workspace_id, review_id, sort_order, item_title, is_required, is_default)
    select t.workspace_id, rid, x.sort_order, x.item_title, x.is_required, x.is_default from public.qa_check_items x where x.review_id = p_copy_from;
  end if;
  return rid;
end $$;
revoke execute on function app.qa_insert_round(app.qa_target, integer, uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 5) 검수 RPC
-- ─────────────────────────────────────────────
-- 5-1) 회차 열기: 산출물 현재 판이 검토 완료·보관 안 됨이고 열린 회차가 없을 때
create or replace function public.open_qa_review(p_target_kind text, p_target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t   app.qa_target;
  n   integer;
  rid uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  t := app.qa_target_of(p_target_kind, p_target_id, true);
  if t.target_id is null then
    raise exception 'NOT_FOUND: 검수할 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if t.archived then
    raise exception 'INVALID_TRANSITION: 바탕 결과물이 보관되어 검수할 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_qa_open(t);
  if not t.reviewed then
    raise exception 'INVALID_TRANSITION: 결과물이 검토 완료 상태여야 검수를 시작할 수 있습니다' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(35001, hashtext(t.target_id::text)); -- 이름공간 35001(산출물 검수 회차) + 산출물
  if exists (select 1 from public.qa_reviews x where x.target_id = t.target_id and x.status in ('drafting', 'fix_requested') and x.archived_at is null) then
    raise exception 'VALIDATION: 진행 중인 검수 회차가 있습니다' using errcode = '22023';
  end if;
  select coalesce(max(x.round_no), 0) + 1 into n from public.qa_reviews x where x.target_id = t.target_id;
  if n > 30 then
    raise exception 'LIMIT_REACHED: 검수 회차는 30회까지 기록할 수 있습니다' using errcode = 'P0001';
  end if;
  rid := app.qa_insert_round(t, n, null);
  perform app.qa_audit(t.workspace_id, 'qa_review', rid, 'qa_review_open', 1,
                       jsonb_build_object('target_kind', t.kind, 'target_version_no', t.version_no, 'round_no', n));
  return rid;
end $$;
revoke execute on function public.open_qa_review(text, uuid) from public, anon;
grant execute on function public.open_qa_review(text, uuid) to authenticated;

-- 5-2) 항목 판정·메모(서버가 검수자·시각을 찍는다)
create or replace function public.set_qa_item(p_review_id uuid, p_expected_revision integer, p_item_id uuid, p_verdict text, p_memo text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r  public.qa_reviews%rowtype;
  it public.qa_check_items%rowtype;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  r := app.lock_own_qa_review(p_review_id);
  perform app.assert_qa_review_open(r, p_expected_revision);
  select x.* into it from public.qa_check_items x where x.id = p_item_id and x.review_id = r.id;
  if not found then
    raise exception 'NOT_FOUND: 검수 항목을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_verdict is null or p_verdict not in ('pending', 'passed', 'needs_fix') then
    raise exception 'VALIDATION: 알 수 없는 판정입니다' using errcode = '22023';
  end if;
  if p_memo is not null and not app.ppt_text_ok(p_memo, 500) then
    raise exception 'VALIDATION: 검수 메모는 500자까지입니다(제어 문자 불가)' using errcode = '22023';
  end if;
  if p_verdict = 'needs_fix' and p_memo is null then
    raise exception 'VALIDATION: 보완 필요로 판정하려면 검수 메모를 적어 주세요' using errcode = '22023';
  end if;
  if p_verdict = it.verdict and p_memo is not distinct from it.memo then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  update public.qa_check_items
     set verdict = p_verdict, memo = p_memo,
         checked_by = case when p_verdict = 'pending' then null else auth.uid() end,
         checked_at = case when p_verdict = 'pending' then null else now() end
   where id = it.id;
  update public.qa_reviews set updated_at = now() where id = r.id returning revision into rv;
  perform app.qa_audit(r.workspace_id, 'qa_review', r.id, 'qa_item_set', rv, jsonb_build_object('sort_order', it.sort_order, 'verdict', p_verdict));
  return rv;
end $$;
revoke execute on function public.set_qa_item(uuid, integer, uuid, text, text) from public, anon;
grant execute on function public.set_qa_item(uuid, integer, uuid, text, text) to authenticated;

-- 5-3) 항목 더하기(최대 30)·빼기(기본 필수 항목은 못 뺀다)
create or replace function public.add_qa_item(p_review_id uuid, p_expected_revision integer, p_title text, p_is_required boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r  public.qa_reviews%rowtype;
  n  integer;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  r := app.lock_own_qa_review(p_review_id);
  perform app.assert_qa_review_open(r, p_expected_revision);
  if not app.ppt_text_ok(p_title, 120) then
    raise exception 'VALIDATION: 항목 제목은 1~120자로 입력해 주세요(제어 문자 불가)' using errcode = '22023';
  end if;
  if p_is_required is null then
    raise exception 'VALIDATION: 필수 여부를 골라 주세요' using errcode = '22023';
  end if;
  select count(*) into n from public.qa_check_items x where x.review_id = r.id;
  if n >= 30 then
    raise exception 'LIMIT_REACHED: 검수 항목은 회차당 30개까지입니다' using errcode = 'P0001';
  end if;
  insert into public.qa_check_items (workspace_id, review_id, sort_order, item_title, is_required, is_default)
  values (r.workspace_id, r.id, n + 1, p_title, p_is_required, false);
  update public.qa_reviews set updated_at = now() where id = r.id returning revision into rv;
  perform app.qa_audit(r.workspace_id, 'qa_review', r.id, 'qa_item_add', rv, jsonb_build_object('sort_order', n + 1, 'is_required', p_is_required));
  return rv;
end $$;
revoke execute on function public.add_qa_item(uuid, integer, text, boolean) from public, anon;
grant execute on function public.add_qa_item(uuid, integer, text, boolean) to authenticated;

create or replace function public.remove_qa_item(p_review_id uuid, p_expected_revision integer, p_item_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r  public.qa_reviews%rowtype;
  it public.qa_check_items%rowtype;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  r := app.lock_own_qa_review(p_review_id);
  perform app.assert_qa_review_open(r, p_expected_revision);
  select x.* into it from public.qa_check_items x where x.id = p_item_id and x.review_id = r.id;
  if not found then
    raise exception 'NOT_FOUND: 검수 항목을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if it.is_default then
    raise exception 'VALIDATION: 기본 필수 항목은 뺄 수 없습니다' using errcode = '22023';
  end if;
  delete from public.qa_check_items where id = it.id;
  update public.qa_check_items set sort_order = sort_order - 1 where review_id = r.id and sort_order > it.sort_order;
  update public.qa_reviews set updated_at = now() where id = r.id returning revision into rv;
  perform app.qa_audit(r.workspace_id, 'qa_review', r.id, 'qa_item_remove', rv, jsonb_build_object('sort_order', it.sort_order));
  return rv;
end $$;
revoke execute on function public.remove_qa_item(uuid, integer, uuid) from public, anon;
grant execute on function public.remove_qa_item(uuid, integer, uuid) to authenticated;

-- 5-4) 보완 요청: needs_fix 1개 이상 → fix_requested(산출물 표는 바꾸지 않는다, Master ②)
create or replace function public.request_qa_fix(p_review_id uuid, p_expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r  public.qa_reviews%rowtype;
  n  integer;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  r := app.lock_own_qa_review(p_review_id);
  perform app.assert_qa_review_open(r, p_expected_revision);
  if r.status = 'fix_requested' then
    raise exception 'INVALID_TRANSITION: 이미 보완 요청을 보낸 회차입니다' using errcode = 'P0001';
  end if;
  select count(*) into n from public.qa_check_items x where x.review_id = r.id and x.verdict = 'needs_fix';
  if n = 0 then
    raise exception 'VALIDATION: 보완 필요 항목이 없습니다' using errcode = '22023';
  end if;
  update public.qa_reviews set status = 'fix_requested' where id = r.id returning revision into rv;
  perform app.qa_audit(r.workspace_id, 'qa_review', r.id, 'qa_fix_requested', rv, jsonb_build_object('round_no', r.round_no, 'needs_fix', n));
  return rv;
end $$;
revoke execute on function public.request_qa_fix(uuid, integer) from public, anon;
grant execute on function public.request_qa_fix(uuid, integer) to authenticated;

-- 5-5) 승인 게이트: 필수 항목 모두 passed + 대상 판이 아직 현재 판(stale 아님) + 산출물 보관 안 됨·검토 완료
create or replace function public.approve_qa_review(p_review_id uuid, p_expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r   public.qa_reviews%rowtype;
  t   app.qa_target;
  bad integer;
  tot integer;
  rv  integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  r := app.lock_own_qa_review(p_review_id);
  perform app.assert_qa_review_open(r, p_expected_revision);
  t := app.qa_target_of(r.target_kind, r.target_id, true);
  if t.archived then
    raise exception 'INVALID_TRANSITION: 바탕 결과물이 보관되어 승인할 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_qa_open(t);
  if t.version_id is distinct from app.qa_review_target(r) then
    raise exception 'INVALID_TRANSITION: 검수 대상 결과물이 새 버전으로 수정되었습니다. 새 버전에 맞춰 재검수가 필요합니다' using errcode = 'P0001';
  end if;
  if not t.reviewed then
    raise exception 'INVALID_TRANSITION: 결과물이 검토 완료 상태가 아니라 승인할 수 없습니다' using errcode = 'P0001';
  end if;
  select count(*) filter (where x.is_required and x.verdict <> 'passed'), count(*) filter (where x.is_required)
    into bad, tot from public.qa_check_items x where x.review_id = r.id;
  if tot = 0 or bad > 0 then
    raise exception 'VALIDATION: 보완 필요 또는 미확인 필수 항목이 남아 있어 승인할 수 없습니다' using errcode = '22023';
  end if;
  update public.qa_reviews set status = 'reviewed', approved_at = now(), approved_by = auth.uid() where id = r.id returning revision into rv;
  perform app.qa_audit(r.workspace_id, 'qa_review', r.id, 'qa_approve', rv,
                       jsonb_build_object('target_kind', r.target_kind, 'target_version_no', r.target_version_no, 'round_no', r.round_no, 'required', tot));
  return rv;
end $$;
revoke execute on function public.approve_qa_review(uuid, integer) from public, anon;
grant execute on function public.approve_qa_review(uuid, integer) to authenticated;

-- 5-6) 새 판 기준 재검수: 이전 기준(stale)인 열린 회차를 보관하고, 항목 제목·필수 여부를 옮긴 새 회차(판정 pending)
create or replace function public.rebase_qa_review(p_review_id uuid, p_expected_revision integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r   public.qa_reviews%rowtype;
  t   app.qa_target;
  rid uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  r := app.lock_own_qa_review(p_review_id);
  perform app.assert_qa_review_open(r, p_expected_revision);
  t := app.qa_target_of(r.target_kind, r.target_id, true);
  if t.archived then
    raise exception 'INVALID_TRANSITION: 바탕 결과물이 보관되어 검수할 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_qa_open(t);
  if t.version_id = app.qa_review_target(r) then
    raise exception 'VALIDATION: 이미 지금 버전 기준 검수입니다' using errcode = '22023';
  end if;
  if not t.reviewed then
    raise exception 'INVALID_TRANSITION: 결과물이 검토 완료 상태여야 검수를 시작할 수 있습니다' using errcode = 'P0001';
  end if;
  if r.round_no >= 30 then
    raise exception 'LIMIT_REACHED: 검수 회차는 30회까지 기록할 수 있습니다' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(35001, hashtext(t.target_id::text));
  update public.qa_reviews set archived_at = now() where id = r.id;
  rid := app.qa_insert_round(t, (select max(x.round_no) from public.qa_reviews x where x.target_id = t.target_id) + 1, r.id);
  perform app.qa_audit(r.workspace_id, 'qa_review', rid, 'qa_review_rebase', 1,
                       jsonb_build_object('from_round_no', r.round_no, 'target_version_no', t.version_no));
  return rid;
end $$;
revoke execute on function public.rebase_qa_review(uuid, integer) from public, anon;
grant execute on function public.rebase_qa_review(uuid, integer) to authenticated;

-- 5-7) 보관(되돌리기 없음). 승인한 회차를 보관하면 그 승인은 납품에 더는 쓰이지 않는다
create or replace function public.archive_qa_review(p_review_id uuid, p_expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r  public.qa_reviews%rowtype;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  r := app.lock_own_qa_review(p_review_id);
  if r.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if r.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 검수 회차입니다' using errcode = 'P0001';
  end if;
  update public.qa_reviews set archived_at = now() where id = r.id returning revision into rv;
  perform app.qa_audit(r.workspace_id, 'qa_review', r.id, 'qa_review_archive', rv, jsonb_build_object('round_no', r.round_no, 'status', r.status));
  return rv;
end $$;
revoke execute on function public.archive_qa_review(uuid, integer) from public, anon;
grant execute on function public.archive_qa_review(uuid, integer) to authenticated;

-- ─────────────────────────────────────────────
-- 6) 납품 RPC
-- ─────────────────────────────────────────────
-- 지금 넣을 수 있는 승인본: 산출물별 최근 승인 회차(보관 안 됨)의 판(산출물 보관이면 제외) + 확정·보관 안 된 브리프의 현재 revision
create or replace function app.delivery_candidates(p_project uuid)
returns table (kind text, target_id uuid, version_id uuid, version_no integer, qa_review_id uuid, brief_revision integer)
language sql stable set search_path = '' as $$
  with latest as (
    select distinct on (r.target_id) r.target_kind, r.target_id, app.qa_review_target(r) as version_id, r.target_version_no, r.id
      from public.qa_reviews r
     where r.project_id = p_project and r.status = 'reviewed' and r.archived_at is null
     order by r.target_id, r.round_no desc
  )
  select l.target_kind, l.target_id, l.version_id, l.target_version_no, l.id, null::integer
    from latest l
   where not coalesce(case l.target_kind
           when 'web_copy' then (select d.archived_at is not null from public.web_copy_docs d where d.id = l.target_id)
           when 'design_assets' then (select a.archived_at is not null from public.design_assets a where a.id = l.target_id)
           when 'video_plan' then (select p.archived_at is not null from public.video_plans p where p.id = l.target_id)
           when 'ppt_deck' then (select d.archived_at is not null from public.ppt_decks d where d.id = l.target_id) end, true)
  union all
  select 'production_brief', b.id, null, b.revision, null, b.revision
    from public.production_briefs b
   where b.project_id = p_project and b.status = 'ready' and b.archived_at is null
$$;
revoke execute on function app.delivery_candidates(uuid) from public, anon, authenticated;

-- 묶음 + 항목 넣기(후보 표에서). 검수 대상 항목이 1개 이상이어야 한다
create or replace function app.delivery_insert(p_ws uuid, p_project uuid, p_restored_from uuid, p_items jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare
  bid uuid := gen_random_uuid();
  n   integer;
  e   jsonb;
  i   integer := 0;
  k   text;
  tid uuid;
  vid uuid;
  sha text;
begin
  if (select count(*) from jsonb_array_elements(p_items) x where x ->> 'kind' <> 'production_brief') = 0 then
    raise exception 'VALIDATION: 검수 체크리스트를 통과한 승인본이 1건 이상 있어야 납품 묶음을 만들 수 있습니다' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'LIMIT_REACHED: 납품 묶음 항목은 100건까지입니다' using errcode = 'P0001';
  end if;
  select coalesce(max(x.bundle_no), 0) + 1 into n from public.delivery_bundles x where x.project_id = p_project;
  if n > 50 then
    raise exception 'LIMIT_REACHED: 납품 묶음 스냅샷은 50개까지 만들 수 있습니다' using errcode = 'P0001';
  end if;
  insert into public.delivery_bundles (id, workspace_id, project_id, bundle_no, restored_from_id, item_count, created_by)
  values (bid, p_ws, p_project, n, p_restored_from, jsonb_array_length(p_items), auth.uid());
  for e in select x from jsonb_array_elements(p_items) x loop
    i := i + 1;
    k := e ->> 'kind';
    tid := (e ->> 'target_id')::uuid;
    vid := (e ->> 'version_id')::uuid;
    sha := case when k = 'production_brief'
             then (select encode(sha256(convert_to((to_jsonb(b) - 'updated_at' - 'created_at' - 'archived_at')::text, 'UTF8')), 'hex') from public.production_briefs b where b.id = tid)
             else app.qa_version_sha(k, vid) end;
    insert into public.delivery_bundle_items (workspace_id, project_id, bundle_id, sort_order, kind, production_brief_id, brief_revision,
                                              web_copy_doc_id, web_copy_version_id, design_asset_id, design_asset_version_id,
                                              video_plan_id, video_plan_version_id, ppt_deck_id, ppt_deck_version_id,
                                              version_no, qa_review_id, content_sha256)
    values (p_ws, p_project, bid, i, k, case when k = 'production_brief' then tid end, case when k = 'production_brief' then (e ->> 'version_no')::integer end,
            case when k = 'web_copy' then tid end, case when k = 'web_copy' then vid end,
            case when k = 'design_assets' then tid end, case when k = 'design_assets' then vid end,
            case when k = 'video_plan' then tid end, case when k = 'video_plan' then vid end,
            case when k = 'ppt_deck' then tid end, case when k = 'ppt_deck' then vid end,
            (e ->> 'version_no')::integer, (e ->> 'qa_review_id')::uuid, sha);
  end loop;
  return bid;
end $$;
revoke execute on function app.delivery_insert(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- 프로젝트를 본인 것만 읽고 열려 있는지 확인(보관이면 INVALID_TRANSITION)
create or replace function app.own_open_project(p_project uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  ws uuid;
  st text;
begin
  select p.workspace_id, p.status into ws, st from public.projects p
   where p.id = p_project and exists (select 1 from public.workspaces w where w.id = p.workspace_id and w.owner_user_id = auth.uid());
  if ws is null then
    raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if st = 'archived' then
    raise exception 'INVALID_TRANSITION: 바탕 프로젝트가 보관되어 새 납품 묶음이나 전달 기록을 추가할 수 없습니다' using errcode = 'P0001';
  end if;
  return ws;
end $$;
revoke execute on function app.own_open_project(uuid) from public, anon, authenticated;

-- 6-1) 묶음 만들기: 서버가 지금 승인본을 모은다(클라이언트 목록을 받지 않는다)
create or replace function public.create_delivery_bundle(p_project_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws    uuid;
  items jsonb;
  bid   uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  ws := app.own_open_project(p_project_id);
  perform pg_advisory_xact_lock(35002, hashtext(p_project_id::text)); -- 이름공간 35002(프로젝트 납품 묶음) + 프로젝트
  select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'target_id', c.target_id, 'version_id', c.version_id, 'version_no', c.version_no,
                                               'qa_review_id', c.qa_review_id)
                            order by case c.kind when 'production_brief' then 0 when 'web_copy' then 1 when 'design_assets' then 2 when 'video_plan' then 3 else 4 end, c.target_id), '[]'::jsonb)
    into items from app.delivery_candidates(p_project_id) c;
  bid := app.delivery_insert(ws, p_project_id, null, items);
  perform app.qa_audit(ws, 'delivery_bundle', bid, 'delivery_bundle_create', 1, jsonb_build_object('item_count', jsonb_array_length(items)));
  return bid;
end $$;
revoke execute on function public.create_delivery_bundle(uuid) from public, anon;
grant execute on function public.create_delivery_bundle(uuid) to authenticated;

-- 6-2) 복구: 옛 묶음 구성 중 지금도 승인 상태(같은 판·같은 승인 회차, 브리프는 같은 revision)인 항목만으로 새 묶음
create or replace function public.restore_delivery_bundle(p_bundle_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b     public.delivery_bundles%rowtype;
  ws    uuid;
  items jsonb;
  bid   uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into b from public.delivery_bundles x
   where x.id = p_bundle_id and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid());
  if not found then
    raise exception 'NOT_FOUND: 납품 묶음을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  ws := app.own_open_project(b.project_id);
  perform pg_advisory_xact_lock(35002, hashtext(b.project_id::text));
  select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'target_id', coalesce(i.production_brief_id, i.web_copy_doc_id, i.design_asset_id, i.video_plan_id, i.ppt_deck_id),
                                               'version_id', coalesce(i.web_copy_version_id, i.design_asset_version_id, i.video_plan_version_id, i.ppt_deck_version_id),
                                               'version_no', i.version_no, 'qa_review_id', i.qa_review_id) order by i.sort_order), '[]'::jsonb)
    into items
    from public.delivery_bundle_items i
   where i.bundle_id = b.id
     and exists (select 1 from app.delivery_candidates(b.project_id) c
                  where c.kind = i.kind and c.target_id = coalesce(i.production_brief_id, i.web_copy_doc_id, i.design_asset_id, i.video_plan_id, i.ppt_deck_id)
                    and c.version_no = i.version_no and c.qa_review_id is not distinct from i.qa_review_id);
  bid := app.delivery_insert(ws, b.project_id, b.id, items);
  perform app.qa_audit(ws, 'delivery_bundle', bid, 'delivery_bundle_restore', 1,
                       jsonb_build_object('restored_from_bundle_no', b.bundle_no, 'item_count', jsonb_array_length(items)));
  return bid;
end $$;
revoke execute on function public.restore_delivery_bundle(uuid) from public, anon;
grant execute on function public.restore_delivery_bundle(uuid) to authenticated;

create or replace function app.lock_own_bundle(p_id uuid, p_expected_revision integer) returns public.delivery_bundles
language plpgsql set search_path = '' as $$
declare
  b public.delivery_bundles%rowtype;
begin
  select x.* into b from public.delivery_bundles x
   where x.id = p_id and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
   for update of x;
  if not found then
    raise exception 'NOT_FOUND: 납품 묶음을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 납품 묶음입니다. 조회와 내려받기만 할 수 있습니다' using errcode = 'P0001';
  end if;
  perform app.own_open_project(b.project_id);
  return b;
end $$;
revoke execute on function app.lock_own_bundle(uuid, integer) from public, anon, authenticated;

-- 6-3) 상태만(drafting·reviewed)
create or replace function public.update_delivery_bundle(p_bundle_id uuid, p_expected_revision integer, p_status text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b  public.delivery_bundles%rowtype;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.lock_own_bundle(p_bundle_id, p_expected_revision);
  if p_status is null or p_status not in ('drafting', 'reviewed') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
  if p_status = b.status then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  update public.delivery_bundles set status = p_status where id = b.id returning revision into rv;
  perform app.qa_audit(b.workspace_id, 'delivery_bundle', b.id, 'delivery_bundle_update', rv, jsonb_build_object('status', p_status));
  return rv;
end $$;
revoke execute on function public.update_delivery_bundle(uuid, integer, text) from public, anon;
grant execute on function public.update_delivery_bundle(uuid, integer, text) to authenticated;

-- 6-4) 보관(되돌리기 없음). 이후 전달 기록은 못 남기지만 새 묶음은 만들 수 있다
create or replace function public.archive_delivery_bundle(p_bundle_id uuid, p_expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b  public.delivery_bundles%rowtype;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.lock_own_bundle(p_bundle_id, p_expected_revision);
  update public.delivery_bundles set archived_at = now() where id = b.id returning revision into rv;
  perform app.qa_audit(b.workspace_id, 'delivery_bundle', b.id, 'delivery_bundle_archive', rv, jsonb_build_object('bundle_no', b.bundle_no));
  return rv;
end $$;
revoke execute on function public.archive_delivery_bundle(uuid, integer) from public, anon;
grant execute on function public.archive_delivery_bundle(uuid, integer) to authenticated;

-- 6-5) 고객 전달 기록(추가 전용, 묶음당 50, 실제 발송 없음)
create or replace function public.add_delivery_log(p_bundle_id uuid, p_expected_revision integer, p_method text, p_delivered_at timestamptz, p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b  public.delivery_bundles%rowtype;
  n  integer;
  rv integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.lock_own_bundle(p_bundle_id, p_expected_revision);
  if p_method is null or p_method not in ('email', 'cloud_link', 'messenger', 'in_person') then
    raise exception 'VALIDATION: 알 수 없는 전달 방식입니다' using errcode = '22023';
  end if;
  if p_delivered_at is null or p_delivered_at < timestamptz '2000-01-01 00:00:00+09' or p_delivered_at > now() + interval '5 minutes' then
    raise exception 'VALIDATION: 전달 일시가 올바르지 않습니다(미래 시각 불가)' using errcode = '22023';
  end if;
  if p_note is not null and not app.ppt_text_ok(p_note, 300) then
    raise exception 'VALIDATION: 전달 메모는 300자까지입니다(제어 문자 불가)' using errcode = '22023';
  end if;
  select count(*) into n from public.delivery_logs x where x.bundle_id = b.id;
  if n >= 50 then
    raise exception 'LIMIT_REACHED: 고객 전달 기록은 묶음당 50건까지 남길 수 있습니다' using errcode = 'P0001';
  end if;
  insert into public.delivery_logs (workspace_id, bundle_id, method, delivered_at, note, created_by)
  values (b.workspace_id, b.id, p_method, p_delivered_at, p_note, auth.uid());
  update public.delivery_bundles set updated_at = now() where id = b.id returning revision into rv;
  perform app.qa_audit(b.workspace_id, 'delivery_bundle', b.id, 'delivery_log_add', rv, jsonb_build_object('method', p_method, 'log_count', n + 1));
  return rv;
end $$;
revoke execute on function public.add_delivery_log(uuid, integer, text, timestamptz, text) from public, anon;
grant execute on function public.add_delivery_log(uuid, integer, text, timestamptz, text) to authenticated;
