-- P2G-BACKEND-01 채널 초안(P2-g) 서버. 설계: Plan/Claude-Backend-20261118/P2G-BACKEND-01-DESIGN.md (Master 수락)
-- 범위: 주인님 DEC-16 — 티스토리 블로그 1개, 한국어만. 자동 게시는 없다(R08): 외부 요청·API·OAuth 를 두지 않는다.
--
-- 바뀌는 것
--   1) channel_drafts: 준비 완료(ready)·보관 안 된 blog 브리프에서 만드는 티스토리 초안(브리프 1 : N, 보관 안 된 것 5개까지).
--      만들 때 브리프 입력을 사본(source_snapshot)으로 고정한다. 편집 필드 5개(제목·본문·태그·대표 이미지 안내·메타 설명).
--      본문은 "제한 마크다운" 글자다. HTML 은 저장하지 않는다(내보낼 때 앱의 순수 함수가 허용 태그만 조립).
--      참조 전략 버전은 브리프의 것을 복사, 다시 맞추기는 수동(DEC-P2-01-A: stale 표시만).
--   2) channel_publications: 수동 게시 기록(추가 전용). 잘못 적은 기록은 취소 행(kind 'void')을 더한다. https 주소만.
--   3) content_briefs 에 unique(id, strategy_artifact_id) 추가(초안의 복합 FK 용 — 초안의 전략 산출물은 브리프와 같아야 한다).
--   4) 두 표 모두 select 만 본인 업무실, 직접 쓰기 회수. 쓰기는 정의자 RPC 6개만, RPC 마다 감사 1행(entity_type 'channel_draft').
--
-- 바뀌지 않는 것: 기존 표 데이터, record_delivery·브리프·퍼널·리드마그넷 RPC 본문과 인자.
-- 잠금: 초안 RPC 는 초안 하나 또는 브리프 하나만 FOR UPDATE 로 잡는다(브리프 RPC 와 같은 시작점).
--   퍼널·카드·단계는 읽기만 하므로 R1 순서(카드 → 리드마그넷 → 단계 → 퍼널)와 반대 방향이 없다.
--
-- 정의자 함수 규칙(퍼널·브리프와 같음): search_path='' 고정·스키마 표기, 맨 앞 auth.uid() 확인,
--   소유 조건을 조회 WHERE 안에 넣어 남의 행은 잠그지 않음, 남의 것·없는 것은 같은 NOT_FOUND, public·anon 실행 권한 회수.

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 게시 주소: https:// + 점이 있는 ASCII 호스트(+포트) + 보이는 ASCII 글자(!~)만인 나머지, 2048자 이하.
--   @·\ 는 호스트 글자가 아니므로 사용자 정보(https://a@b)·역슬래시 우회는 거절된다.
--   나머지를 보이는 ASCII 로 한정해 공백·제어 문자·서식 문자(ZWSP·RLO 등, QA D2)가 모두 거절되고, 앱(JS)과 식이 똑같다(QA D1).
--   앱은 new URL() 로 정규화(퓨니코드·소문자 호스트, 한글 경로는 %인코딩)한 값을 보낸다
create or replace function app.publication_url_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and length(p) <= 2048
     and p ~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][!-~]*)?$'
$$;
revoke execute on function app.publication_url_ok(text) from public, anon;

-- 태그: 문자열 배열 10개까지, 각 1~30자, 정리된 값, 대소문자를 무시하고 중복 없음
create or replace function app.draft_tags_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select app.brief_str_array_ok(p, 10, 30)
     and p = app.lead_str_array(p)
     and (select count(distinct lower(e #>> '{}')) from jsonb_array_elements(p) e) = jsonb_array_length(p)
$$;
revoke execute on function app.draft_tags_ok(jsonb) from public, anon;

-- 본문: 줄바꿈을 \n 으로 맞추고 앞뒤 공백류를 지운다(빈 본문은 '')
create or replace function app.draft_body(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(app.funnel_trim(replace(replace(p, E'\r\n', E'\n'), E'\r', E'\n')), '')
$$;
revoke execute on function app.draft_body(text) from public, anon;

-- 입력 사본: 객체이고 정해진 키만
create or replace function app.draft_snapshot_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and not exists (select 1 from jsonb_object_keys(p) k
                      where k not in ('title', 'audience', 'hook', 'coreMessage', 'cta', 'titleIdeas', 'outline', 'keywords', 'claims'))
$$;
revoke execute on function app.draft_snapshot_ok(jsonb) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
alter table public.content_briefs add constraint content_briefs_id_strategy_artifact_key unique (id, strategy_artifact_id);

create table public.channel_drafts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null,
  brief_id              uuid not null,
  strategy_artifact_id  uuid not null,
  strategy_version_id   uuid not null,
  channel               text not null default 'tistory' check (channel = 'tistory'),
  language              text not null default 'ko' check (language = 'ko'),
  source_brief_revision integer not null check (source_brief_revision > 0),
  source_snapshot       jsonb not null check (app.draft_snapshot_ok(source_snapshot)),
  title                 text not null check (length(title) between 1 and 200 and title = app.funnel_trim(title)),
  body                  text not null default '' check (length(body) <= 20000 and body = app.draft_body(body)),
  tags                  jsonb not null default '[]'::jsonb check (app.draft_tags_ok(tags)),
  image_note            text check (image_note is null or (length(image_note) between 1 and 500 and image_note = app.funnel_trim(image_note))),
  meta_description      text check (meta_description is null or (length(meta_description) between 1 and 300 and meta_description = app.funnel_trim(meta_description))),
  status                text not null default 'drafting' check (status in ('drafting', 'reviewed')),
  archived_at           timestamptz,
  revision              integer not null default 1,
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (workspace_id, brief_id) references public.content_briefs (workspace_id, id),
  -- 전략 산출물은 브리프와 같고, 전략 판은 그 산출물의 판이어야 한다(다른 프로젝트를 가리킬 수 없음)
  foreign key (brief_id, strategy_artifact_id) references public.content_briefs (id, strategy_artifact_id),
  foreign key (strategy_artifact_id, strategy_version_id) references public.artifact_versions (artifact_id, id),
  unique (workspace_id, id)
);
create index channel_drafts_active on public.channel_drafts (brief_id, created_at) where archived_at is null;

create trigger channel_drafts_guard before update on public.channel_drafts
  for each row execute function app.guard_update('id', 'workspace_id', 'brief_id', 'strategy_artifact_id', 'channel', 'language',
                                                 'source_brief_revision', 'source_snapshot', 'created_by', 'created_at');

create table public.channel_publications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  draft_id     uuid not null,
  kind         text not null check (kind in ('record', 'void')),
  url          text check (url is null or app.publication_url_ok(url)),
  published_at timestamptz check (published_at is null or published_at >= timestamptz '2000-01-01 00:00:00+09'),
  note         text check (note is null or (length(note) between 1 and 300 and note = app.funnel_trim(note))),
  voids_id     uuid unique,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  check (
    (kind = 'record' and url is not null and published_at is not null and voids_id is null) or
    (kind = 'void' and voids_id is not null and note is not null and url is null and published_at is null)
  ),
  foreign key (workspace_id, draft_id) references public.channel_drafts (workspace_id, id),
  -- 취소 대상은 같은 초안의 기록만
  unique (draft_id, id),
  foreign key (draft_id, voids_id) references public.channel_publications (draft_id, id)
);
create index channel_publications_draft on public.channel_publications (draft_id, created_at);

-- 추가 전용: 고치기·지우기는 거절(잘못 적은 기록은 취소 행을 더한다)
create trigger channel_publications_append_only before update or delete on public.channel_publications
  for each row execute function app.reject_mutation();

-- ─────────────────────────────────────────────
-- 2) RLS·권한: select 만 본인 업무실, 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.channel_drafts       enable row level security;
alter table public.channel_publications enable row level security;
create policy channel_drafts_select       on public.channel_drafts       for select to authenticated using (app.owns_workspace(workspace_id));
create policy channel_publications_select on public.channel_publications for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.channel_drafts, public.channel_publications from anon;
revoke insert, update, delete, truncate on public.channel_drafts, public.channel_publications from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미 (정의자 RPC 안에서만 부른다)
-- ─────────────────────────────────────────────
-- 초안을 고칠 수 있는지: 초안 보관 아님 + 브리프의 퍼널이 열림(작업 취소·프로젝트 보관 아님).
--   브리프가 보관되거나 drafting 으로 돌아가도 이미 만든 초안은 고칠 수 있다(초안은 입력 사본, Master 수락 9-③)
create or replace function app.assert_channel_draft_open(p_draft_id uuid) returns void
language plpgsql stable set search_path = '' as $$
declare
  arch timestamptz;
  fid  uuid;
begin
  select d.archived_at, b.funnel_id into arch, fid
    from public.channel_drafts d join public.content_briefs b on b.id = d.brief_id
   where d.id = p_draft_id;
  if arch is not null then
    raise exception 'INVALID_TRANSITION: 보관한 초안은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_funnel_open(fid);
end $$;
revoke execute on function app.assert_channel_draft_open(uuid) from public, anon, authenticated;

-- 값 검사(문구를 구체적으로 돌려주려고 CHECK 앞에서 한 번 더 본다). 정리 전 값을 받는다
create or replace function app.check_channel_draft(p_title text, p_body text, p_tags jsonb, p_image_note text, p_meta text, p_status text)
returns void
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(length(app.funnel_trim(p_title)), 0) not between 1 and 200 then
    raise exception 'VALIDATION: 제목은 1~200자여야 합니다' using errcode = '22023';
  end if;
  if length(app.draft_body(p_body)) > 20000 then
    raise exception 'VALIDATION: 본문은 20000자 이하여야 합니다' using errcode = '22023';
  end if;
  if not app.brief_str_array_ok(coalesce(p_tags, '[]'::jsonb), 10, 30) then
    raise exception 'VALIDATION: 태그는 10개까지, 각 1~30자여야 합니다' using errcode = '22023';
  end if;
  if not app.draft_tags_ok(app.lead_str_array(coalesce(p_tags, '[]'::jsonb))) then
    raise exception 'VALIDATION: 같은 태그가 두 번 있습니다' using errcode = '22023';
  end if;
  if p_image_note is not null and length(app.funnel_trim(p_image_note)) > 500 then
    raise exception 'VALIDATION: 대표 이미지 안내는 500자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_meta is not null and length(app.funnel_trim(p_meta)) > 300 then
    raise exception 'VALIDATION: 메타 설명은 300자 이하여야 합니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('drafting', 'reviewed') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
end $$;
revoke execute on function app.check_channel_draft(text, text, jsonb, text, text, text) from public, anon, authenticated;

create or replace function app.channel_draft_audit(p_ws uuid, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'channel_draft', p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.channel_draft_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

-- 초안 하나를 본인 것만 잠근다(없거나 남의 것이면 NOT_FOUND)
create or replace function app.lock_own_channel_draft(p_draft_id uuid) returns public.channel_drafts
language plpgsql set search_path = '' as $$
declare
  d public.channel_drafts%rowtype;
begin
  select x.* into d
    from public.channel_drafts x
   where x.id = p_draft_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 초안을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return d;
end $$;
revoke execute on function app.lock_own_channel_draft(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 만들기. 브리프 행을 잠가 개수 한도 계산·브리프 보관과 겹치지 않게 한다(브리프 RPC 와 같은 시작점)
create or replace function public.create_channel_draft(p_brief_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  b    public.content_briefs%rowtype;
  n    integer;
  snap jsonb;
  tg   jsonb;
  bd   text;
  d_id uuid;
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
  if b.channel <> 'blog' then
    raise exception 'VALIDATION: 티스토리 초안은 블로그 브리프로만 만들 수 있습니다' using errcode = '22023';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 브리프로는 초안을 만들 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(b.id);
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 준비 완료 브리프로만 초안을 만들 수 있습니다' using errcode = 'P0001';
  end if;
  select count(*) into n from public.channel_drafts d where d.brief_id = b.id and d.archived_at is null;
  if n >= 5 then
    raise exception 'VALIDATION: 한 브리프에는 초안을 5개까지 둘 수 있습니다' using errcode = '22023';
  end if;

  -- 입력 사본(A2): 만든 뒤 브리프를 고쳐도 바뀌지 않는다
  snap := jsonb_strip_nulls(jsonb_build_object(
    'title', b.title, 'audience', b.audience, 'hook', b.hook, 'coreMessage', b.core_message, 'cta', b.cta,
    'titleIdeas', b.channel_spec -> 'titleIdeas', 'outline', b.channel_spec -> 'outline', 'keywords', b.channel_spec -> 'keywords',
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('text', c.text, 'kind', c.claim_kind) order by c.position), '[]'::jsonb)
                 from public.content_brief_claims c where c.brief_id = b.id and c.archived_at is null)
  ));
  -- 태그 초기값: 키워드 앞에서부터 30자로 자르고 정리, 대소문자 무시 중복 제거, 10개까지
  select coalesce(jsonb_agg(to_jsonb(t.v) order by t.n), '[]'::jsonb) into tg
    from (
      select u.v, u.n
        from (
          select distinct on (lower(k.v)) k.v, k.n
            from (select app.funnel_trim(left(app.funnel_trim(e.v #>> '{}'), 30)) as v, e.n
                    from jsonb_array_elements(coalesce(b.channel_spec -> 'keywords', '[]'::jsonb)) with ordinality as e(v, n)) k
           where length(k.v) > 0
           order by lower(k.v), k.n
        ) u
       order by u.n
       limit 10
    ) t;
  -- 본문 초기값(템플릿, AI 없음): 훅 → 핵심 메시지 → 목차마다 소제목 → CTA. 빈 것은 건너뛴다
  select string_agg(p.part, E'\n\n' order by p.ord, p.sub) into bd
    from (
      select 1 as ord, 0::bigint as sub, b.hook as part where b.hook is not null
      union all select 2, 0, b.core_message where b.core_message is not null
      union all select 3, o.n, '## ' || app.funnel_trim(o.v #>> '{}') || E'\n\n(내용을 써 주세요)'
                  from jsonb_array_elements(coalesce(b.channel_spec -> 'outline', '[]'::jsonb)) with ordinality as o(v, n)
      union all select 4, 0, b.cta where b.cta is not null
    ) p;

  insert into public.channel_drafts (workspace_id, brief_id, strategy_artifact_id, strategy_version_id, source_brief_revision, source_snapshot,
                                     title, body, tags, meta_description, created_by)
  values (b.workspace_id, b.id, b.strategy_artifact_id, b.strategy_version_id, b.revision, snap,
          b.title, app.draft_body(bd), tg, nullif(app.funnel_trim(left(b.core_message, 160)), ''), uid)
  returning id into d_id;
  perform app.channel_draft_audit(b.workspace_id, d_id, 'draft_create', 1,
                                  jsonb_build_object('brief_id', b.id, 'brief_revision', b.revision, 'strategy_version_id', b.strategy_version_id));
  return d_id;
end $$;
revoke execute on function public.create_channel_draft(uuid) from public, anon;
grant execute on function public.create_channel_draft(uuid) to authenticated;

-- 4-2) 수정(값 전체 교체). 상태는 drafting·reviewed 만(게시 기록됨은 게시 기록에서 계산한다)
create or replace function public.update_channel_draft(
  p_draft_id          uuid,
  p_expected_revision integer,
  p_title             text,
  p_body              text,
  p_tags              jsonb,
  p_image_note        text,
  p_meta_description  text,
  p_status            text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.channel_drafts%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_channel_draft(p_draft_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_channel_draft_open(d.id);
  perform app.check_channel_draft(p_title, p_body, p_tags, p_image_note, p_meta_description, p_status);
  update public.channel_drafts
     set title = app.funnel_trim(p_title),
         body = app.draft_body(p_body),
         tags = app.lead_str_array(coalesce(p_tags, '[]'::jsonb)),
         image_note = app.brief_text(p_image_note, 500, '대표 이미지 안내'),
         meta_description = app.brief_text(p_meta_description, 300, '메타 설명'),
         status = p_status
   where id = d.id
   returning revision into r;
  perform app.channel_draft_audit(d.workspace_id, d.id, 'draft_update', r, jsonb_build_object('status', p_status));
  return r;
end $$;
revoke execute on function public.update_channel_draft(uuid, integer, text, text, jsonb, text, text, text) from public, anon;
grant execute on function public.update_channel_draft(uuid, integer, text, text, jsonb, text, text, text) to authenticated;

-- 4-3) 다시 맞추기: 참조 전략 버전을 지금 승인본으로(수동)
create or replace function public.rebase_channel_draft(p_draft_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d  public.channel_drafts%rowtype;
  ap uuid;
  r  integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_channel_draft(p_draft_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_channel_draft_open(d.id);
  select a.approved_version_id into ap from public.artifacts a where a.id = d.strategy_artifact_id;
  if ap is null then
    raise exception 'STRATEGY_NOT_APPROVED: 승인된 전략이 없습니다' using errcode = 'P0001';
  end if;
  if ap = d.strategy_version_id then
    raise exception 'VALIDATION: 이미 지금 승인된 전략 기준입니다' using errcode = '22023';
  end if;
  update public.channel_drafts set strategy_version_id = ap where id = d.id returning revision into r;
  perform app.channel_draft_audit(d.workspace_id, d.id, 'draft_rebase', r,
                                  jsonb_build_object('from_version_id', d.strategy_version_id, 'to_version_id', ap));
  return r;
end $$;
revoke execute on function public.rebase_channel_draft(uuid, integer) from public, anon;
grant execute on function public.rebase_channel_draft(uuid, integer) to authenticated;

-- 4-4) 보관(삭제 대신). 보관한 초안은 읽기·복사·내보내기만 된다
create or replace function public.archive_channel_draft(p_draft_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d   public.channel_drafts%rowtype;
  fid uuid;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_channel_draft(p_draft_id);
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if d.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 초안입니다' using errcode = 'P0001';
  end if;
  select b.funnel_id into fid from public.content_briefs b where b.id = d.brief_id;
  perform app.assert_funnel_open(fid);
  update public.channel_drafts set archived_at = now() where id = d.id returning revision into r;
  perform app.channel_draft_audit(d.workspace_id, d.id, 'draft_archive', r, '{}'::jsonb);
  return r;
end $$;
revoke execute on function public.archive_channel_draft(uuid, integer) from public, anon;
grant execute on function public.archive_channel_draft(uuid, integer) to authenticated;

-- 4-5) 수동 게시 기록(추가). 초안 revision 은 올리지 않는다(다른 탭의 편집과 충돌하지 않게).
--   초안 행을 잠가 기록 수 한도(취소 안 된 기록 50) 계산이 겹치지 않게 한다. 게시 시각은 미래 5분까지(record_delivery 와 같은 규칙)
create or replace function public.record_channel_publication(p_draft_id uuid, p_url text, p_published_at timestamptz, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  d    public.channel_drafts%rowtype;
  u    text := app.funnel_trim(p_url);
  n    integer;
  p_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  d := app.lock_own_channel_draft(p_draft_id);
  perform app.assert_channel_draft_open(d.id);
  if not coalesce(app.publication_url_ok(u), false) then
    raise exception 'VALIDATION: 게시 주소는 https:// 로 시작하는 올바른 주소여야 합니다(2048자 이하)' using errcode = '22023';
  end if;
  if p_published_at is null then
    raise exception 'VALIDATION: 게시 시각을 입력해 주세요' using errcode = '22023';
  end if;
  if p_published_at > now() + interval '5 minutes' then
    raise exception 'VALIDATION: 게시 시각이 미래입니다' using errcode = '22023';
  end if;
  if p_published_at < timestamptz '2000-01-01 00:00:00+09' then
    raise exception 'VALIDATION: 게시 시각이 너무 이릅니다(2000년 이후만)' using errcode = '22023';
  end if;
  -- 한도는 취소되지 않은 기록만 센다(QA D3). 취소 행은 기록마다 하나뿐이라 전체 행 수도 100을 넘지 않는다
  select count(*) into n from public.channel_publications c
   where c.draft_id = d.id and c.kind = 'record'
     and not exists (select 1 from public.channel_publications v where v.voids_id = c.id);
  if n >= 50 then
    raise exception 'VALIDATION: 한 초안에는 취소하지 않은 게시 기록을 50개까지 남길 수 있습니다' using errcode = '22023';
  end if;
  insert into public.channel_publications (workspace_id, draft_id, kind, url, published_at, note, created_by)
  values (d.workspace_id, d.id, 'record', u, p_published_at, app.brief_text(p_note, 300, '메모'), uid)
  returning id into p_id;
  perform app.channel_draft_audit(d.workspace_id, d.id, 'publication_record', null,
                                  jsonb_build_object('publication_id', p_id, 'published_at', p_published_at));
  return p_id;
end $$;
revoke execute on function public.record_channel_publication(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.record_channel_publication(uuid, text, timestamptz, text) to authenticated;

-- 4-6) 게시 기록 취소(취소 행 추가). 같은 초안의 기록만, 한 번만. 취소의 취소는 없다
create or replace function public.void_channel_publication(p_publication_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  pub  public.channel_publications%rowtype;
  d    public.channel_drafts%rowtype;
  rs   text := nullif(app.funnel_trim(p_reason), '');
  v_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  -- 기록은 추가 전용이라 잠그지 않고 읽는다. 잠금은 그 초안 행(record 와 같은 시작점)
  select x.* into pub
    from public.channel_publications x
   where x.id = p_publication_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid);
  if not found then
    raise exception 'NOT_FOUND: 게시 기록을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  d := app.lock_own_channel_draft(pub.draft_id);
  perform app.assert_channel_draft_open(d.id);
  if pub.kind <> 'record' then
    raise exception 'INVALID_TRANSITION: 취소 표시는 다시 취소할 수 없습니다' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.channel_publications c where c.voids_id = pub.id) then
    raise exception 'INVALID_TRANSITION: 이미 취소한 게시 기록입니다' using errcode = 'P0001';
  end if;
  if rs is null or length(rs) > 300 then
    raise exception 'VALIDATION: 취소 이유는 1~300자여야 합니다' using errcode = '22023';
  end if;
  insert into public.channel_publications (workspace_id, draft_id, kind, note, voids_id, created_by)
  values (d.workspace_id, d.id, 'void', rs, pub.id, uid)
  returning id into v_id;
  perform app.channel_draft_audit(d.workspace_id, d.id, 'publication_void', null,
                                  jsonb_build_object('publication_id', v_id, 'voids_id', pub.id));
  return v_id;
end $$;
revoke execute on function public.void_channel_publication(uuid, text) from public, anon;
grant execute on function public.void_channel_publication(uuid, text) to authenticated;
