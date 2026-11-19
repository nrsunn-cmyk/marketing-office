-- P3B-BACKEND-IMPL-01 홈페이지 구조·문구(P3-b, web_copy) 서버. 설계: Plan/Claude-Backend-20261120/P3B-BACKEND-01-DESIGN.md (Master 수락, 8절 결정 5건)
-- 범위: 확정(ready)·보관 안 된 제작 브리프(포함 산출물에 web_copy)를 바탕으로 홈페이지 페이지·섹션 문구를 판(version) 단위로 남긴다.
--   AI 호출 없음: 첫 판은 AGY 확정 템플릿(P3B-DEFAULT-TEMPLATE.md)으로 채운다. HTML 생성·게시 없음.
--
-- 바뀌는 것
--   1) web_copy_docs: 문서 메타(브리프 1 : 보관 안 된 문서 1, 보관 포함 10). 상태 drafting/reviewed + archived_at, 현재 판 번호.
--   2) web_copy_versions: 판(추가 전용). 저장·되돌리기·맞추기마다 문서 전체(페이지·섹션)를 content jsonb 로 새 판 1행. 문서당 100판.
--      판 내용 검사는 app.web_copy_content_problem 한 곳(CHECK 와 RPC 문구가 같은 판정).
--   3) select 만 본인 업무실, 직접 쓰기 회수. 쓰기는 정의자 RPC 5개만, 감사 1행(entity_type 'web_copy_doc', 본문 없음).
--
-- 바뀌지 않는 것: 기존 표·RPC(제작 브리프 포함). 기존 표에 제약을 더하지 않는다(production_briefs unique(project_id, id) 는 28 이 이미 둠).
-- 잠금: 만들기는 브리프 행 FOR SHARE → advisory(29001, 브리프). 나머지는 문서 한 행 FOR UPDATE. 브리프·프로젝트·출처는 읽기만.

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 페이지 경로: 홈 '/' 또는 한 단계 '/영소문자-숫자' (80자 이하)
create or replace function app.web_copy_slug_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p is not null and length(p) between 1 and 80 and p ~ '^/([a-z0-9]+(-[a-z0-9]+)*)?$', false)
$$;
revoke execute on function app.web_copy_slug_ok(text) from public, anon;

-- CTA 이동 대상: '/경로'(하위 경로·#조각 허용) 또는 https 주소(P2-g 게시 주소 규칙), 200자 이하
create or replace function app.web_copy_cta_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p is not null and length(p) between 1 and 200
     and (p ~ '^/([a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*)?(#[A-Za-z0-9_-]{1,50})?$' or app.publication_url_ok(p)), false)
$$;
revoke execute on function app.web_copy_cta_ok(text) from public, anon;

-- 글 정리: 문자열이면 앞뒤 공백류를 지운다(본문은 줄바꿈도 \n 으로). 선택 칸은 빈 글이면 null. 문자열이 아니면 그대로(검사가 거절)
create or replace function app.wc_text(v jsonb, p_optional boolean, p_body boolean) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when v is null or jsonb_typeof(v) <> 'string' then v
    else (select case when p_optional and t = '' then 'null'::jsonb else to_jsonb(t) end
            from (select case when p_body then app.draft_body(v #>> '{}') else coalesce(app.funnel_trim(v #>> '{}'), '') end as t) x)
  end
$$;
revoke execute on function app.wc_text(jsonb, boolean, boolean) from public, anon;

-- 판 내용 정리: 알려진 글 칸만 정리하고, 모양은 바꾸지 않는다(모르는 키·잘못된 형은 검사가 거절)
create or replace function app.web_copy_normalize(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  pages jsonb := '[]'::jsonb;
  secs  jsonb;
  pg    jsonb;
  sc    jsonb;
begin
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'pages') <> 'array' then
    return p;
  end if;
  for pg in select e from jsonb_array_elements(p -> 'pages') e loop
    if jsonb_typeof(pg) = 'object' then
      if pg ? 'title' then pg := jsonb_set(pg, '{title}', app.wc_text(pg -> 'title', false, false)); end if;
      if pg ? 'slug' then pg := jsonb_set(pg, '{slug}', app.wc_text(pg -> 'slug', false, false)); end if;
      if jsonb_typeof(pg -> 'sections') = 'array' then
        secs := '[]'::jsonb;
        for sc in select e from jsonb_array_elements(pg -> 'sections') e loop
          if jsonb_typeof(sc) = 'object' then
            if sc ? 'section_name' then sc := jsonb_set(sc, '{section_name}', app.wc_text(sc -> 'section_name', false, false)); end if;
            if sc ? 'headline' then sc := jsonb_set(sc, '{headline}', app.wc_text(sc -> 'headline', false, false)); end if;
            if sc ? 'purpose' then sc := jsonb_set(sc, '{purpose}', app.wc_text(sc -> 'purpose', true, false)); end if;
            if sc ? 'body' then sc := jsonb_set(sc, '{body}', app.wc_text(sc -> 'body', true, true)); end if;
            if sc ? 'cta_label' then sc := jsonb_set(sc, '{cta_label}', app.wc_text(sc -> 'cta_label', true, false)); end if;
            if sc ? 'cta_target' then sc := jsonb_set(sc, '{cta_target}', app.wc_text(sc -> 'cta_target', true, false)); end if;
          end if;
          secs := secs || jsonb_build_array(sc);
        end loop;
        pg := jsonb_set(pg, '{sections}', secs);
      end if;
    end if;
    pages := pages || jsonb_build_array(pg);
  end loop;
  return jsonb_set(p, '{pages}', pages);
end $$;
revoke execute on function app.web_copy_normalize(jsonb) from public, anon;

-- 칸 형식 이름. 칸이 없으면(SQL NULL) 'missing' — 비교가 NULL 이 되어 검사를 빠져나가지 않게(P3A D1 과 같은 함정)
create or replace function app.jt(v jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(v), 'missing')
$$;
revoke execute on function app.jt(jsonb) from public, anon;

-- 판 내용 검사: 문제가 없으면 null, 있으면 첫 문제의 한글 문구. 정리된 값과 채워진 id 를 기준으로 본다.
--   모양(정해진 키만), 페이지 1~10, 섹션 페이지당 1~12·전체 60(제외 포함), 칸별 글자 수(코드 포인트), 경로·CTA 형식,
--   정렬 번호 = 배열 순서, 출처 0~10·중복 없음(존재는 RPC 가 본다), id 는 uuid·문서 안에서 중복 없음, 경로 중복 없음
create or replace function app.web_copy_content_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  pg     jsonb;
  sc     jsonb;
  pi     integer := 0;
  si     integer;
  total  integer := 0;
  ids    text[] := '{}';
  slugs  text[] := '{}';
  k      text;
  c      jsonb;
  t      text;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p is null or app.jt(p) <> 'object' or app.jt(p -> 'pages') <> 'array' then
    return '내용 형식이 올바르지 않습니다(pages 목록이 필요합니다)';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k <> 'pages' then return format('알 수 없는 칸입니다: %s', k); end if;
  end loop;
  if jsonb_array_length(p -> 'pages') not between 1 and 10 then
    return '페이지는 1~10개여야 합니다';
  end if;
  for pg in select e from jsonb_array_elements(p -> 'pages') e loop
    pi := pi + 1;
    if app.jt(pg) <> 'object' then return format('%s번째 페이지 형식이 올바르지 않습니다', pi); end if;
    for k in select jsonb_object_keys(pg) loop
      if k not in ('id', 'title', 'slug', 'sort_order', 'sections') then return format('%s번째 페이지에 알 수 없는 칸이 있습니다: %s', pi, k); end if;
    end loop;
    if app.jt(pg -> 'id') <> 'string' or (pg ->> 'id') !~ uuid_re then return format('%s번째 페이지의 id 가 올바르지 않습니다', pi); end if;
    if (pg ->> 'id') = any(ids) then return '같은 id 가 두 번 있습니다'; end if;
    ids := ids || (pg ->> 'id');
    t := case when app.jt(pg -> 'title') = 'string' then pg ->> 'title' end;
    if t is null or length(t) not between 1 and 60 or t <> app.funnel_trim(t) then return format('%s번째 페이지 이름은 1~60자여야 합니다', pi); end if;
    t := case when app.jt(pg -> 'slug') = 'string' then pg ->> 'slug' end;
    if not app.web_copy_slug_ok(t) then return format('%s번째 페이지 경로는 / 로 시작하고 영소문자·숫자·- 만 쓸 수 있습니다(80자 이하, 한 단계)', pi); end if;
    if t = any(slugs) then return format('페이지 경로 %s 가 두 번 있습니다', t); end if;
    slugs := slugs || t;
    if app.jt(pg -> 'sort_order') <> 'number' or (pg ->> 'sort_order') <> pi::text then return '페이지 정렬 번호는 1부터 빈틈 없이 순서대로여야 합니다'; end if;
    if app.jt(pg -> 'sections') <> 'array' or jsonb_array_length(pg -> 'sections') not between 1 and 12 then
      return format('%s번째 페이지의 섹션은 1~12개여야 합니다(제외한 섹션 포함)', pi);
    end if;
    si := 0;
    for sc in select e from jsonb_array_elements(pg -> 'sections') e loop
      si := si + 1;
      total := total + 1;
      if app.jt(sc) <> 'object' then return format('%s번째 페이지 %s번째 섹션 형식이 올바르지 않습니다', pi, si); end if;
      for k in select jsonb_object_keys(sc) loop
        if k not in ('id', 'section_name', 'purpose', 'headline', 'body', 'cta_label', 'cta_target', 'citation_ids', 'sort_order', 'excluded') then
          return format('섹션에 알 수 없는 칸이 있습니다: %s', k);
        end if;
      end loop;
      for k in select unnest(array['section_name', 'purpose', 'headline', 'body', 'cta_label', 'cta_target', 'citation_ids', 'excluded']) loop
        if not sc ? k then return format('섹션에 %s 칸이 없습니다', k); end if;
      end loop;
      if app.jt(sc -> 'id') <> 'string' or (sc ->> 'id') !~ uuid_re then return format('%s번째 페이지 %s번째 섹션의 id 가 올바르지 않습니다', pi, si); end if;
      if (sc ->> 'id') = any(ids) then return '같은 id 가 두 번 있습니다'; end if;
      ids := ids || (sc ->> 'id');
      t := case when app.jt(sc -> 'section_name') = 'string' then sc ->> 'section_name' end;
      if t is null or length(t) not between 1 and 80 or t <> app.funnel_trim(t) then return '섹션 이름은 1~80자여야 합니다'; end if;
      t := case when app.jt(sc -> 'headline') = 'string' then sc ->> 'headline' end;
      if t is null or length(t) not between 1 and 160 or t <> app.funnel_trim(t) then return '헤드라인은 1~160자여야 합니다'; end if;
      c := sc -> 'purpose';
      if app.jt(c) <> 'null' and (app.jt(c) <> 'string' or length(c #>> '{}') not between 1 and 200 or (c #>> '{}') <> app.funnel_trim(c #>> '{}')) then return '섹션 목적은 200자 이하여야 합니다'; end if;
      c := sc -> 'body';
      if app.jt(c) <> 'null' and (app.jt(c) <> 'string' or length(c #>> '{}') not between 1 and 2000 or (c #>> '{}') <> app.draft_body(c #>> '{}')) then return '본문은 2000자 이하여야 합니다'; end if;
      c := sc -> 'cta_label';
      if app.jt(c) <> 'null' and (app.jt(c) <> 'string' or length(c #>> '{}') not between 1 and 60 or (c #>> '{}') <> app.funnel_trim(c #>> '{}')) then return 'CTA 버튼 문구는 60자 이하여야 합니다'; end if;
      c := sc -> 'cta_target';
      if app.jt(c) <> 'null' and (app.jt(c) <> 'string' or not app.web_copy_cta_ok(c #>> '{}')) then return 'CTA 이동 대상은 /경로 또는 https:// 주소여야 합니다(200자 이하)'; end if;
      c := sc -> 'citation_ids';
      if app.jt(c) <> 'array' or jsonb_array_length(c) > 10 then return '근거 출처는 10개까지 연결할 수 있습니다'; end if;
      if exists (select 1 from jsonb_array_elements(c) e where app.jt(e) <> 'string' or (e #>> '{}') !~ uuid_re) then return '근거 출처 id 가 올바르지 않습니다'; end if;
      if (select count(distinct e #>> '{}') from jsonb_array_elements(c) e) <> jsonb_array_length(c) then return '같은 출처를 두 번 연결할 수 없습니다'; end if;
      if app.jt(sc -> 'sort_order') <> 'number' or (sc ->> 'sort_order') <> si::text then return '섹션 정렬 번호는 1부터 빈틈 없이 순서대로여야 합니다'; end if;
      if app.jt(sc -> 'excluded') <> 'boolean' then return '제외 여부는 참·거짓이어야 합니다'; end if;
    end loop;
  end loop;
  if total > 60 then
    return '섹션은 문서 전체 60개까지입니다(제외한 섹션 포함)';
  end if;
  return null;
end $$;
revoke execute on function app.web_copy_content_problem(jsonb) from public, anon;

-- CHECK 용: NULL 로 빠지지 않게 coalesce(Tester P3A D1 교훈)
create or replace function app.web_copy_content_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(app.web_copy_content_problem(p) is null, false)
$$;
revoke execute on function app.web_copy_content_ok(jsonb) from public, anon;

-- 기본 4페이지(AGY 확정 C:/nadaum/Design/p3-production/P3B-DEFAULT-TEMPLATE.md). 홈 첫 섹션 헤드라인은 브리프 제목(있으면).
--   id 는 넣는 쪽(RPC)이 채운다. 이 함수 결과를 src/domain/web-copy/template.ts 와 시험이 맞대어 본다
create or replace function app.web_copy_default_content(p_brief_title text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('pages', jsonb_build_array(
    jsonb_build_object('id', null, 'title', '홈', 'slug', '/', 'sort_order', 1, 'sections', jsonb_build_array(
      jsonb_build_object('id', null, 'section_name', '첫 화면', 'purpose', '방문자에게 핵심 가치와 다음 행동을 안내하는 자리입니다.',
        'headline', coalesce(nullif(app.funnel_trim(left(p_brief_title, 160)), ''), '[직접 입력: 고객에게 전달할 핵심 한 줄 제목]'),
        'body', '[직접 입력: 제작 브리프의 핵심 대상과 해결 내용을 2~3문장으로 적어 주세요.]',
        'cta_label', '문의하기', 'cta_target', '/contact', 'citation_ids', '[]'::jsonb, 'sort_order', 1, 'excluded', false),
      jsonb_build_object('id', null, 'section_name', '신뢰 근거', 'purpose', '사실에 근거한 작업 방식이나 확인 가능한 사례를 적는 자리입니다.',
        'headline', '[직접 입력: 고객이 안심할 수 있는 진행 기준]',
        'body', '[직접 입력: 실제 진행 절차나 확인된 출처가 있는 내용만 적어 주세요. 출처를 연결하면 검수 시 확인하기 쉽습니다.]',
        'cta_label', '서비스 자세히 보기', 'cta_target', '/services', 'citation_ids', '[]'::jsonb, 'sort_order', 2, 'excluded', false))),
    jsonb_build_object('id', null, 'title', '회사 소개', 'slug', '/about', 'sort_order', 2, 'sections', jsonb_build_array(
      jsonb_build_object('id', null, 'section_name', '회사 소개', 'purpose', '브랜드가 일하는 기준과 역할을 소개하는 자리입니다.',
        'headline', '[직접 입력: 우리가 지키는 일의 기준]',
        'body', '[직접 입력: 어떤 고객을 돕고 무엇을 중요하게 여기는지 쉬운 말로 적어 주세요.]',
        'cta_label', null, 'cta_target', null, 'citation_ids', '[]'::jsonb, 'sort_order', 1, 'excluded', false))),
    jsonb_build_object('id', null, 'title', '서비스 안내', 'slug', '/services', 'sort_order', 3, 'sections', jsonb_build_array(
      jsonb_build_object('id', null, 'section_name', '제공 서비스', 'purpose', '제공하는 서비스 범위와 진행 순서를 안내하는 자리입니다.',
        'headline', '[직접 입력: 제공하는 서비스와 포함 범위]',
        'body', '[직접 입력: 포함되는 작업과 제외되는 범위를 구분해 적고, 다음 단계 안내를 덧붙여 주세요.]',
        'cta_label', '상담·문의하기', 'cta_target', '/contact', 'citation_ids', '[]'::jsonb, 'sort_order', 1, 'excluded', false))),
    jsonb_build_object('id', null, 'title', '문의', 'slug', '/contact', 'sort_order', 4, 'sections', jsonb_build_array(
      jsonb_build_object('id', null, 'section_name', '문의 안내', 'purpose', '방문자가 상담이나 견적을 남길 수 있게 안내하는 자리입니다.',
        'headline', '[직접 입력: 상담·문의 전 확인 안내]',
        'body', '[직접 입력: 응답 가능 시간과 문의 시 함께 적어 주면 좋은 내용을 안내해 주세요.]',
        'cta_label', '문의 남기기', 'cta_target', '/contact', 'citation_ids', '[]'::jsonb, 'sort_order', 1, 'excluded', false)))
  ))
$$;
revoke execute on function app.web_copy_default_content(text) from public, anon;

-- 빈 id(null)를 새 uuid 로 채운다. 이미 있는 id 는 그대로(허용 여부는 RPC 가 현재 판과 대조)
create or replace function app.web_copy_fill_ids(p jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  pages jsonb := '[]'::jsonb;
  secs  jsonb;
  pg    jsonb;
  sc    jsonb;
begin
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'pages') <> 'array' then
    return p;
  end if;
  for pg in select e from jsonb_array_elements(p -> 'pages') e loop
    if jsonb_typeof(pg) = 'object' then
      if coalesce(jsonb_typeof(pg -> 'id'), 'null') = 'null' then pg := jsonb_set(pg, '{id}', to_jsonb(gen_random_uuid()::text)); end if;
      if jsonb_typeof(pg -> 'sections') = 'array' then
        secs := '[]'::jsonb;
        for sc in select e from jsonb_array_elements(pg -> 'sections') e loop
          if jsonb_typeof(sc) = 'object' and coalesce(jsonb_typeof(sc -> 'id'), 'null') = 'null' then
            sc := jsonb_set(sc, '{id}', to_jsonb(gen_random_uuid()::text));
          end if;
          secs := secs || jsonb_build_array(sc);
        end loop;
        pg := jsonb_set(pg, '{sections}', secs);
      end if;
    end if;
    pages := pages || jsonb_build_array(pg);
  end loop;
  return jsonb_set(p, '{pages}', pages);
end $$;
revoke execute on function app.web_copy_fill_ids(jsonb) from public, anon;

-- 판 내용의 페이지 id·섹션 id 목록
create or replace function app.web_copy_ids(p jsonb, p_kind text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x), '{}') from (
    select pg ->> 'id' as x from jsonb_array_elements(p -> 'pages') pg where p_kind = 'page'
    union all
    select sc ->> 'id' from jsonb_array_elements(p -> 'pages') pg, jsonb_array_elements(pg -> 'sections') sc where p_kind = 'section'
  ) t where x is not null
$$;
revoke execute on function app.web_copy_ids(jsonb, text) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
create table public.web_copy_docs (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null,
  project_id            uuid not null,
  production_brief_id   uuid not null,
  source_brief_revision integer not null check (source_brief_revision > 0),
  status                text not null default 'drafting' check (status in ('drafting', 'reviewed')),
  current_version_no    integer not null check (current_version_no between 1 and 100),
  archived_at           timestamptz,
  revision              integer not null default 1,
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  -- 바탕은 같은 프로젝트의 제작 브리프
  foreign key (project_id, production_brief_id) references public.production_briefs (project_id, id),
  unique (workspace_id, id),
  unique (project_id, id)
);
-- 보관 안 된 문서는 브리프 하나에 1개(동시 만들기는 RPC 가 advisory lock 으로 먼저 거른다)
create unique index web_copy_docs_one_active on public.web_copy_docs (production_brief_id) where archived_at is null;
create index web_copy_docs_brief on public.web_copy_docs (production_brief_id, created_at);

create table public.web_copy_versions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  doc_id                   uuid not null,
  version_no               integer not null check (version_no between 1 and 100),
  kind                     text not null check (kind in ('create', 'save', 'restore', 'rebase')),
  status                   text not null check (status in ('drafting', 'reviewed')),
  content                  jsonb not null check (app.web_copy_content_ok(content)),
  source_brief_revision    integer not null check (source_brief_revision > 0),
  restored_from_version_no integer check (restored_from_version_no is null or restored_from_version_no > 0),
  created_by               uuid not null references auth.users (id),
  created_at               timestamptz not null default now(),
  check ((kind = 'restore') = (restored_from_version_no is not null)),
  foreign key (workspace_id, doc_id) references public.web_copy_docs (workspace_id, id),
  unique (doc_id, version_no),
  -- 뒤 단계(P3-f 검수·P3-g 납품)가 "이 문서의 판"을 복합 FK 로 가리킬 자리
  unique (doc_id, id)
);

-- 현재 판은 그 문서의 판이어야 한다(같은 트랜잭션에서 판을 먼저 넣으므로 커밋 때 확인)
alter table public.web_copy_docs
  add constraint web_copy_docs_current_version_fkey foreign key (id, current_version_no)
  references public.web_copy_versions (doc_id, version_no) deferrable initially deferred;

create trigger web_copy_docs_guard before update on public.web_copy_docs
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'production_brief_id', 'created_by', 'created_at');

-- 보관한 문서는 어떤 칸도 바꿀 수 없다(보관 되돌리기 포함)
create or replace function app.web_copy_doc_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 홈페이지 문서는 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.web_copy_doc_frozen() from public, anon, authenticated;
create trigger web_copy_docs_frozen before update on public.web_copy_docs
  for each row execute function app.web_copy_doc_frozen();

-- 판은 추가만(고치기·지우기 거절)
create trigger web_copy_versions_append_only before update or delete on public.web_copy_versions
  for each row execute function app.reject_mutation();

-- ─────────────────────────────────────────────
-- 2) RLS·권한: select 만 본인 업무실, 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.web_copy_docs     enable row level security;
alter table public.web_copy_versions enable row level security;
create policy web_copy_docs_select     on public.web_copy_docs     for select to authenticated using (app.owns_workspace(workspace_id));
create policy web_copy_versions_select on public.web_copy_versions for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.web_copy_docs, public.web_copy_versions from anon;
revoke insert, update, delete, truncate on public.web_copy_docs, public.web_copy_versions from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미 (정의자 RPC 안에서만 부른다)
-- ─────────────────────────────────────────────
create or replace function app.web_copy_audit(p_ws uuid, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'web_copy_doc', p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.web_copy_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

-- 판 내용의 개수 요약(감사용, 본문 없음)
create or replace function app.web_copy_counts(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'pages', jsonb_array_length(p -> 'pages'),
    'sections', (select count(*) from jsonb_array_elements(p -> 'pages') pg, jsonb_array_elements(pg -> 'sections') sc),
    'excluded', (select count(*) from jsonb_array_elements(p -> 'pages') pg, jsonb_array_elements(pg -> 'sections') sc where (sc ->> 'excluded')::boolean))
$$;
revoke execute on function app.web_copy_counts(jsonb) from public, anon, authenticated;

-- 문서 하나를 본인 것만 잠근다(없거나 남의 것이면 NOT_FOUND)
create or replace function app.lock_own_web_copy_doc(p_doc_id uuid) returns public.web_copy_docs
language plpgsql set search_path = '' as $$
declare
  d public.web_copy_docs%rowtype;
begin
  select x.* into d
    from public.web_copy_docs x
   where x.id = p_doc_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 홈페이지 문서를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return d;
end $$;
revoke execute on function app.lock_own_web_copy_doc(uuid) from public, anon, authenticated;

-- 쓸 수 있는지: 문서 보관 아님 + 프로젝트 보관 아님 + 바탕 전략 작업 취소 아님(제작 브리프와 같은 판정)
create or replace function app.assert_web_copy_open(p_doc public.web_copy_docs) returns void
language plpgsql stable set search_path = '' as $$
declare
  sa uuid;
begin
  if p_doc.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 홈페이지 문서는 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  select b.strategy_artifact_id into sa from public.production_briefs b where b.id = p_doc.production_brief_id;
  perform app.assert_production_open(p_doc.project_id, sa);
end $$;
revoke execute on function app.assert_web_copy_open(public.web_copy_docs) from public, anon, authenticated;

-- 새 판 넣기 + 문서 현재 판·상태 바꾸기(판 100 한도). 감사는 부른 쪽이 남긴다
create or replace function app.web_copy_add_version(p_doc public.web_copy_docs, p_kind text, p_status text, p_content jsonb,
                                                     p_brief_revision integer, p_restored_from integer) returns integer
language plpgsql set search_path = '' as $$
declare
  n integer := p_doc.current_version_no + 1;
  r integer;
begin
  if n > 100 then
    raise exception 'LIMIT_REACHED: 한 문서의 판은 100개까지입니다. 문서를 보관하고 새 문서를 만들어 주세요(마지막 판을 복사할 수 있습니다)' using errcode = 'P0001';
  end if;
  insert into public.web_copy_versions (workspace_id, doc_id, version_no, kind, status, content, source_brief_revision, restored_from_version_no, created_by)
  values (p_doc.workspace_id, p_doc.id, n, p_kind, p_status, p_content, p_brief_revision, p_restored_from, auth.uid());
  update public.web_copy_docs set current_version_no = n, status = p_status, source_brief_revision = p_brief_revision
   where id = p_doc.id returning revision into r;
  return r;
end $$;
revoke execute on function app.web_copy_add_version(public.web_copy_docs, text, text, jsonb, integer, integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 만들기. 바탕 = 확정·보관 안 됨·포함 산출물에 web_copy 가 있는 제작 브리프.
--   p_copy_from_doc_id 를 주면 그 문서(같은 브리프)의 현재 판 내용을 복사한다(판 100 이 찼을 때 이어 쓰기, Master 결정 8-②). 없으면 기본 4페이지
create or replace function public.create_web_copy_doc(p_production_brief_id uuid, p_copy_from_doc_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := auth.uid();
  b       public.production_briefs%rowtype;
  n       integer;
  content jsonb;
  prob    text;
  d_id    uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  -- 브리프 행을 FOR SHARE: 만드는 동안 브리프 보관·수정이 끼어들지 않게(P3A R-Q2 와 같은 방식). 그다음 advisory 하나만
  select x.* into b
    from public.production_briefs x
   where x.id = p_production_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for share of x;
  if not found then
    raise exception 'NOT_FOUND: 제작 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프로는 홈페이지 문서를 만들 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_production_open(b.project_id, b.strategy_artifact_id);
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 확정한 제작 브리프로만 홈페이지 문서를 만들 수 있습니다' using errcode = 'P0001';
  end if;
  if not ('web_copy' = any(b.deliverable_types)) then
    raise exception 'INVALID_TRANSITION: 이 제작 브리프의 포함 산출물에 홈페이지 구조·문구가 없습니다' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(29001, hashtext(b.id::text)); -- 이름공간 29001(migration 29 홈페이지 문서) + 브리프
  if exists (select 1 from public.web_copy_docs d where d.production_brief_id = b.id and d.archived_at is null) then
    raise exception 'INVALID_TRANSITION: 이 제작 브리프에는 작업 중인 홈페이지 문서가 이미 있습니다. 그 문서를 쓰거나 보관한 뒤 새로 만들어 주세요' using errcode = 'P0001';
  end if;
  select count(*) into n from public.web_copy_docs d where d.production_brief_id = b.id;
  if n >= 10 then
    raise exception 'LIMIT_REACHED: 한 제작 브리프에는 홈페이지 문서를 10개까지(보관 포함) 만들 수 있습니다' using errcode = 'P0001';
  end if;

  if p_copy_from_doc_id is not null then
    select v.content into content
      from public.web_copy_docs d join public.web_copy_versions v on v.doc_id = d.id and v.version_no = d.current_version_no
     where d.id = p_copy_from_doc_id and d.production_brief_id = b.id;
    if not found then
      raise exception 'NOT_FOUND: 복사할 홈페이지 문서를 찾을 수 없습니다(같은 제작 브리프의 문서만)' using errcode = 'P0002';
    end if;
  else
    content := app.web_copy_fill_ids(app.web_copy_default_content(b.title));
  end if;
  prob := app.web_copy_content_problem(content);
  if prob is not null then
    raise exception 'VALIDATION: %', prob using errcode = '22023';
  end if;

  insert into public.web_copy_docs (workspace_id, project_id, production_brief_id, source_brief_revision, status, current_version_no, created_by)
  values (b.workspace_id, b.project_id, b.id, b.revision, 'drafting', 1, uid)
  returning id into d_id;
  insert into public.web_copy_versions (workspace_id, doc_id, version_no, kind, status, content, source_brief_revision, created_by)
  values (b.workspace_id, d_id, 1, 'create', 'drafting', content, b.revision, uid);
  perform app.web_copy_audit(b.workspace_id, d_id, 'web_copy_create', 1,
                             jsonb_build_object('production_brief_id', b.id, 'brief_revision', b.revision, 'version_no', 1,
                                                'copied_from_doc_id', p_copy_from_doc_id) || app.web_copy_counts(content));
  return d_id;
end $$;
revoke execute on function public.create_web_copy_doc(uuid, uuid) from public, anon;
grant execute on function public.create_web_copy_doc(uuid, uuid) to authenticated;

-- 4-2) 저장: 문서 전체(페이지·섹션)와 상태를 한 번에. 새 판 1개. 바뀐 것이 없으면 거절(감사 0)
create or replace function public.save_web_copy(p_doc_id uuid, p_expected_revision integer, p_status text, p_pages jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d       public.web_copy_docs%rowtype;
  cur     jsonb;
  content jsonb;
  prob    text;
  bad     text;
  r       integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_web_copy_doc(p_doc_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_web_copy_open(d);
  if p_status is null or p_status not in ('drafting', 'reviewed') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
  select v.content into cur from public.web_copy_versions v where v.doc_id = d.id and v.version_no = d.current_version_no;

  content := app.web_copy_normalize(jsonb_build_object('pages', p_pages));
  -- 클라이언트가 보낸 id 는 현재 판에 있는 같은 종류의 id 만(임의 uuid·다른 문서의 id 주입 거절)
  if jsonb_typeof(p_pages) = 'array' then
    select x into bad from (
      select pg ->> 'id' as x from jsonb_array_elements(p_pages) pg
       where jsonb_typeof(pg) = 'object' and jsonb_typeof(pg -> 'id') = 'string' and not ((pg ->> 'id') = any(app.web_copy_ids(cur, 'page')))
      union all
      select sc ->> 'id' from jsonb_array_elements(p_pages) pg, jsonb_array_elements(case when jsonb_typeof(pg -> 'sections') = 'array' then pg -> 'sections' else '[]'::jsonb end) sc
       where jsonb_typeof(pg) = 'object' and jsonb_typeof(sc) = 'object' and jsonb_typeof(sc -> 'id') = 'string' and not ((sc ->> 'id') = any(app.web_copy_ids(cur, 'section')))
    ) t limit 1;
    if bad is not null then
      raise exception 'VALIDATION: 이 문서에 없는 페이지·섹션 id 입니다(새로 만든 것은 id 를 비워 보내 주세요)' using errcode = '22023';
    end if;
  end if;
  content := app.web_copy_fill_ids(content);
  prob := app.web_copy_content_problem(content);
  if prob is not null then
    raise exception 'VALIDATION: %', prob using errcode = '22023';
  end if;
  -- 출처는 같은 업무실·같은 프로젝트의 research_sources 만
  if exists (
    select 1 from jsonb_array_elements(content -> 'pages') pg, jsonb_array_elements(pg -> 'sections') sc, jsonb_array_elements_text(sc -> 'citation_ids') cid
     where not exists (select 1 from public.research_sources s where s.id = cid::uuid and s.workspace_id = d.workspace_id and s.project_id = d.project_id)
  ) then
    raise exception 'VALIDATION: 이 프로젝트의 출처만 연결할 수 있습니다' using errcode = '22023';
  end if;
  if content = cur and p_status = d.status then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  r := app.web_copy_add_version(d, 'save', p_status, content, d.source_brief_revision, null);
  perform app.web_copy_audit(d.workspace_id, d.id, 'web_copy_save', r,
                             jsonb_build_object('version_no', d.current_version_no + 1, 'status_from', d.status, 'status_to', p_status,
                                                'content_changed', content <> cur) || app.web_copy_counts(content));
  return r;
end $$;
revoke execute on function public.save_web_copy(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.save_web_copy(uuid, integer, text, jsonb) to authenticated;

-- 4-3) 되돌리기: 고른 판(번호)의 내용으로 새 판. 지금 판과 내용이 같으면 거절
create or replace function public.restore_web_copy_version(p_doc_id uuid, p_expected_revision integer, p_version_no integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d    public.web_copy_docs%rowtype;
  cur  jsonb;
  old  jsonb;
  r    integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_web_copy_doc(p_doc_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_web_copy_open(d);
  select v.content into old from public.web_copy_versions v where v.doc_id = d.id and v.version_no = p_version_no;
  if not found then
    raise exception 'NOT_FOUND: 이 문서에 그 판이 없습니다' using errcode = 'P0002';
  end if;
  select v.content into cur from public.web_copy_versions v where v.doc_id = d.id and v.version_no = d.current_version_no;
  if old = cur then
    raise exception 'VALIDATION: 지금 판과 내용이 같습니다' using errcode = '22023';
  end if;
  r := app.web_copy_add_version(d, 'restore', d.status, old, d.source_brief_revision, p_version_no);
  perform app.web_copy_audit(d.workspace_id, d.id, 'web_copy_restore', r,
                             jsonb_build_object('from_version_no', p_version_no, 'version_no', d.current_version_no + 1));
  return r;
end $$;
revoke execute on function public.restore_web_copy_version(uuid, integer, integer) from public, anon;
grant execute on function public.restore_web_copy_version(uuid, integer, integer) to authenticated;

-- 4-4) 맞추기: 바탕 브리프의 지금 revision 으로(브리프가 확정·보관 안 됨일 때만). 내용은 그대로 두고 판을 하나 더한다
create or replace function public.rebase_web_copy(p_doc_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d   public.web_copy_docs%rowtype;
  b   public.production_briefs%rowtype;
  cur jsonb;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_web_copy_doc(p_doc_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_web_copy_open(d);
  select x.* into b from public.production_briefs x where x.id = d.production_brief_id;
  if b.archived_at is not null or b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 제작 브리프가 확정 상태가 아니어서 맞출 수 없습니다' using errcode = 'P0001';
  end if;
  if b.revision = d.source_brief_revision then
    raise exception 'VALIDATION: 이미 지금 제작 브리프 기준입니다' using errcode = '22023';
  end if;
  select v.content into cur from public.web_copy_versions v where v.doc_id = d.id and v.version_no = d.current_version_no;
  r := app.web_copy_add_version(d, 'rebase', d.status, cur, b.revision, null);
  perform app.web_copy_audit(d.workspace_id, d.id, 'web_copy_rebase', r,
                             jsonb_build_object('from_brief_revision', d.source_brief_revision, 'to_brief_revision', b.revision, 'version_no', d.current_version_no + 1));
  return r;
end $$;
revoke execute on function public.rebase_web_copy(uuid, integer) from public, anon;
grant execute on function public.rebase_web_copy(uuid, integer) to authenticated;

-- 4-5) 보관(삭제 대신, 되돌리기 없음)
create or replace function public.archive_web_copy(p_doc_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.web_copy_docs%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_web_copy_doc(p_doc_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if d.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 홈페이지 문서입니다' using errcode = 'P0001';
  end if;
  perform app.assert_web_copy_open(d);
  update public.web_copy_docs set archived_at = now() where id = d.id returning revision into r;
  perform app.web_copy_audit(d.workspace_id, d.id, 'web_copy_archive', r, jsonb_build_object('version_no', d.current_version_no, 'status', d.status));
  return r;
end $$;
revoke execute on function public.archive_web_copy(uuid, integer) from public, anon;
grant execute on function public.archive_web_copy(uuid, integer) to authenticated;
