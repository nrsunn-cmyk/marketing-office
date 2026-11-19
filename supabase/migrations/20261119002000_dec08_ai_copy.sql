-- DEC08-AI-COPY-01: 콘텐츠 브리프 AI 문구 초안 생성(주인님 DEC-08 B, 2026-11-19). 판단 자료: Plan/Claude-Backend-20261118/DEC-PREP-08-09.md DEC-08 절.
--
-- 바뀌는 것
--   1) content_briefs.copy_origin 에 'ai' 추가(CHECK 교체). 'ai' 는 accept_brief_copy 로만 들어간다.
--   2) brief_copy_runs: 생성 1번 = 1행. 예약 → 마감(성공·검사 탈락·거절·실패) → (선택) 채택.
--      외부로 보낸 프롬프트 원문은 저장하지 않는다. 결과 변형(variants)만 저장해 채택·재사용에 쓴다.
--      select 만 본인 업무실, 쓰기는 정의자 RPC 3개만(INSERT·UPDATE·DELETE·TRUNCATE 회수).
--   3) 한도(app.brief_copy_limits): 업무실당 하루(업무실 시간대) 30번, 같은 브리프 60초에 1번,
--      월 추정 비용 상한 20,000,000 마이크로달러(20달러, 약 2.9만 원, 공급자 합계).
--      마감 전 예약은 그 모델 요금으로 최대치(입력 12,000 + 출력 20,000 토큰)를 잡아 계산한다(DEC-08-R1).
--   3-1) 허용 공급자·모델(app.brief_copy_models, DEC-08-R1 주인님 지시 "OpenAI / Claude / Gemini 중 선택, 모델도 선택"):
--      서버 목록(src/domain/brief/ai-models.ts)과 같아야 한다(시험으로 대조). 목록 밖 공급자·모델은 예약에서 거절.
--      같은 브리프·같은 입력이 10분 안에 성공했으면 새로 부르지 않고 그 결과를 다시 쓴다(중복 과금 방지).
--   4) RPC: reserve_brief_copy_run · finish_brief_copy_run · accept_brief_copy. 감사: copy_generate(마감), copy_accept(채택).
--   5) update_content_brief: 'ai' 를 직접 보낼 수 없다. 지금 AI 초안이고 카피 글을 바꾸지 않으면 'ai' 유지, 바꾸면 보낸 값.
--
-- 바뀌지 않는 것: 다른 표·RLS·RPC, 근거 연결 규칙(23번), 결과물 경로.
-- 외부 호출(Anthropic)은 서버(src/features/brief/ai-copy.ts)가 한다. DB 는 기록·한도·채택만 맡는다.
-- 정의자 함수 규칙은 22번과 같다(search_path='', auth.uid() 먼저, 소유 조건 WHERE 안 잠금, 남의 것은 NOT_FOUND, public·anon 실행 회수).

-- ─────────────────────────────────────────────
-- 1) copy_origin 'ai'
-- ─────────────────────────────────────────────
alter table public.content_briefs drop constraint content_briefs_copy_origin_check;
alter table public.content_briefs add constraint content_briefs_copy_origin_check check (copy_origin in ('manual', 'template', 'ai'));

-- ─────────────────────────────────────────────
-- 2) 생성 기록
-- ─────────────────────────────────────────────
create table public.brief_copy_runs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  brief_id         uuid not null,
  brief_revision   integer not null check (brief_revision > 0),
  provider         text not null check (provider in ('anthropic', 'openai', 'google')),
  model            text not null check (length(model) between 1 and 100),
  cost_estimate_usd_micro bigint not null check (cost_estimate_usd_micro between 0 and 5000000),
  input_hash       text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  claim_ids        uuid[] not null default '{}' check (cardinality(claim_ids) <= 30),
  status           text not null default 'reserved' check (status in ('reserved', 'succeeded', 'rejected', 'refused', 'failed')),
  variants         jsonb check (variants is null or (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) between 1 and 3)),
  problems         jsonb check (problems is null or jsonb_typeof(problems) = 'array'),
  error_code       text check (error_code is null or length(error_code) <= 100),
  input_tokens     integer check (input_tokens is null or input_tokens >= 0),
  output_tokens    integer check (output_tokens is null or output_tokens >= 0),
  cost_usd_micro   bigint check (cost_usd_micro is null or cost_usd_micro between 0 and 5000000),
  accepted_variant integer check (accepted_variant is null or accepted_variant between 1 and 3),
  created_by       uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  finished_at      timestamptz,
  accepted_at      timestamptz,
  check ((status = 'succeeded') = (variants is not null)),
  check ((status = 'reserved') = (finished_at is null)),
  check ((accepted_variant is null) = (accepted_at is null)),
  check (accepted_variant is null or status = 'succeeded'),
  foreign key (workspace_id, brief_id) references public.content_briefs (workspace_id, id)
);
create index brief_copy_runs_ws_created on public.brief_copy_runs (workspace_id, created_at desc);
create index brief_copy_runs_brief_created on public.brief_copy_runs (brief_id, created_at desc);

alter table public.brief_copy_runs enable row level security;
create policy brief_copy_runs_select on public.brief_copy_runs for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.brief_copy_runs from anon;
revoke insert, update, delete, truncate on public.brief_copy_runs from authenticated;

-- ─────────────────────────────────────────────
-- 3) 한도
-- ─────────────────────────────────────────────
create or replace function app.brief_copy_limits(
  out daily_runs integer, out brief_interval interval, out monthly_cap_usd_micro bigint, out reuse_window interval,
  out estimate_input_tokens integer, out estimate_output_tokens integer
) language sql immutable set search_path = '' as $$
  select 30, interval '60 seconds', 20000000::bigint, interval '10 minutes', 12000, 20000
$$;
revoke execute on function app.brief_copy_limits() from public, anon, authenticated;

-- 허용 공급자·모델과 요금(100만 토큰당 달러 = 토큰당 마이크로달러). 소개 할인 기간이 있는 모델은 할인 뒤(높은) 요금으로 둔다(상한을 넘지 않게).
-- 출처: Anthropic 공개 요금표(2026-11-03 사본), OpenAI developers.openai.com/api/docs/pricing(2026-11-19), Google ai.google.dev/gemini-api/docs/pricing(2026-11-19)
create or replace function app.brief_copy_models()
returns table (provider text, model text, input_usd numeric, output_usd numeric)
language sql immutable set search_path = '' as $$
  values
    ('anthropic', 'claude-sonnet-5-5', 2.00, 10.00),
    ('anthropic', 'claude-haiku-5-5', 0.10, 0.50),
    ('anthropic', 'claude-opus-5-5', 4.00, 20.00),
    ('openai', 'gpt-6.2-sol', 2.00, 10.00),
    ('openai', 'gpt-6-luna', 0.10, 0.50),
    ('openai', 'gpt-6.2-astra', 8.00, 40.00),
    ('google', 'gemini-3.8-flash', 1.50, 7.50),
    ('google', 'gemini-3.5-flash-lite', 0.30, 2.50),
    ('google', 'gemini-4-argon', 4.00, 20.00)
$$;
revoke execute on function app.brief_copy_models() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 예약: 한도 확인 뒤 'reserved' 행을 만든다. 같은 입력의 최근 성공이 있으면 그것을 돌려준다(reused = true).
--      브리프 행을 잠가 같은 브리프의 동시 예약이 겹치지 않게 한다.
create or replace function public.reserve_brief_copy_run(
  p_brief_id          uuid,
  p_expected_revision integer,
  p_input_hash        text,
  p_provider          text,
  p_model             text,
  p_claim_ids         uuid[]
) returns table (run_id uuid, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  b    public.content_briefs%rowtype;
  lim  record;
  tz   text;
  prev uuid;
  n    integer;
  cost bigint;
  est  bigint;
  ids  uuid[] := coalesce(p_claim_ids, '{}');
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
  if p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: 입력 확인값 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  select * into lim from app.brief_copy_limits();
  -- 허용 목록 밖 공급자·모델은 거절(임의 모델 이름 불가). 예약 비용은 그 모델 요금으로 최대치를 잡는다
  select round(lim.estimate_input_tokens * m.input_usd + lim.estimate_output_tokens * m.output_usd)::bigint into est
    from app.brief_copy_models() m where m.provider = p_provider and m.model = p_model;
  if est is null then
    raise exception 'VALIDATION: 고를 수 없는 AI 모델입니다' using errcode = '22023';
  end if;
  if cardinality(ids) > 30 or exists (
    select 1 from unnest(ids) i
     where not exists (select 1 from public.content_brief_claims c where c.id = i and c.brief_id = b.id and c.archived_at is null)
  ) then
    raise exception 'VALIDATION: 이 브리프의 주장만 보낼 수 있습니다' using errcode = '22023';
  end if;

  select r.id into prev
    from public.brief_copy_runs r
   where r.brief_id = b.id and r.status = 'succeeded' and r.input_hash = p_input_hash and r.provider = p_provider and r.model = p_model
     and r.created_at > now() - lim.reuse_window
   order by r.created_at desc limit 1;
  if prev is not null then
    return query select prev, true;
    return;
  end if;

  if exists (select 1 from public.brief_copy_runs r where r.brief_id = b.id and r.created_at > now() - lim.brief_interval) then
    raise exception 'RATE_LIMITED: 같은 브리프는 1분에 한 번만 만들 수 있습니다. 잠시 뒤 다시 시도해 주세요' using errcode = 'P0001';
  end if;
  select w.timezone into tz from public.workspaces w where w.id = b.workspace_id;
  select count(*) into n
    from public.brief_copy_runs r
   where r.workspace_id = b.workspace_id
     and r.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz);
  if n >= lim.daily_runs then
    raise exception 'RATE_LIMITED: 오늘 AI 문구 생성 횟수(%번)를 다 썼습니다. 내일 다시 쓸 수 있습니다', lim.daily_runs using errcode = 'P0001';
  end if;
  select coalesce(sum(case when r.status = 'reserved' then r.cost_estimate_usd_micro else coalesce(r.cost_usd_micro, 0) end), 0) into cost
    from public.brief_copy_runs r
   where r.workspace_id = b.workspace_id
     and r.created_at >= (date_trunc('month', now() at time zone tz) at time zone tz);
  if cost + est > lim.monthly_cap_usd_micro then
    raise exception 'BUDGET_EXCEEDED: 이번 달 AI 문구 생성 비용 상한에 닿았습니다. 다음 달에 다시 쓸 수 있습니다' using errcode = 'P0001';
  end if;

  insert into public.brief_copy_runs (workspace_id, brief_id, brief_revision, provider, model, cost_estimate_usd_micro, input_hash, claim_ids, created_by)
  values (b.workspace_id, b.id, b.revision, p_provider, p_model, est, p_input_hash, ids, uid)
  returning id into prev;
  return query select prev, false;
end $$;
revoke execute on function public.reserve_brief_copy_run(uuid, integer, text, text, text, uuid[]) from public, anon;
grant execute on function public.reserve_brief_copy_run(uuid, integer, text, text, text, uuid[]) to authenticated;

-- 4-2) 마감: 예약 행에 결과를 한 번만 적는다. 성공이면 변형 1~3개(글 1~5000자, 쓴 주장 id 는 예약 때 보낸 것 안에서).
create or replace function public.finish_brief_copy_run(
  p_run_id         uuid,
  p_status         text,
  p_variants       jsonb,
  p_problems       jsonb,
  p_error_code     text,
  p_input_tokens   integer,
  p_output_tokens  integer,
  p_cost_usd_micro bigint
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r   public.brief_copy_runs%rowtype;
  v   jsonb;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into r
    from public.brief_copy_runs x
   where x.id = p_run_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 생성 기록을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if r.status <> 'reserved' then
    raise exception 'INVALID_TRANSITION: 이미 마감한 생성 기록입니다' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('succeeded', 'rejected', 'refused', 'failed') then
    raise exception 'VALIDATION: 알 수 없는 생성 결과입니다' using errcode = '22023';
  end if;
  if (p_status = 'succeeded') <> (p_variants is not null) then
    raise exception 'VALIDATION: 성공일 때만 변형을 저장합니다' using errcode = '22023';
  end if;
  if p_variants is not null then
    if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) not between 1 and 3 then
      raise exception 'VALIDATION: 변형은 1~3개여야 합니다' using errcode = '22023';
    end if;
    for v in select * from jsonb_array_elements(p_variants) loop
      if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) <> 2
         or jsonb_typeof(v -> 'text') <> 'string' or length(v ->> 'text') not between 1 and 5000
         or jsonb_typeof(v -> 'usedClaimIds') <> 'array'
         or exists (select 1 from jsonb_array_elements(v -> 'usedClaimIds') e
                     where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        or not ((e #>> '{}')::uuid = any (r.claim_ids))) then
        raise exception 'VALIDATION: 변형 형식이 올바르지 않거나 보내지 않은 주장을 썼습니다' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_problems is not null and (jsonb_typeof(p_problems) <> 'array' or jsonb_array_length(p_problems) > 20) then
    raise exception 'VALIDATION: 문제 목록 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 or coalesce(p_cost_usd_micro, 0) not between 0 and 5000000 then
    raise exception 'VALIDATION: 사용량 값이 올바르지 않습니다' using errcode = '22023';
  end if;
  update public.brief_copy_runs
     set status = p_status, variants = p_variants, problems = p_problems, error_code = left(p_error_code, 100),
         input_tokens = p_input_tokens, output_tokens = p_output_tokens, cost_usd_micro = p_cost_usd_micro, finished_at = now()
   where id = r.id;
  perform app.brief_audit(r.workspace_id, r.brief_id, 'copy_generate', null,
    jsonb_build_object('run_id', r.id, 'status', p_status, 'provider', r.provider, 'model', r.model, 'input_tokens', p_input_tokens,
                       'output_tokens', p_output_tokens, 'cost_usd_micro', p_cost_usd_micro));
end $$;
revoke execute on function public.finish_brief_copy_run(uuid, text, jsonb, jsonb, text, integer, integer, bigint) from public, anon;
grant execute on function public.finish_brief_copy_run(uuid, text, jsonb, jsonb, text, integer, integer, bigint) to authenticated;

-- 4-3) 채택: 성공한 생성의 n번째 변형을 브리프 카피 초안으로 저장(copy_origin = 'ai'). 한 생성에서 한 번만.
create or replace function public.accept_brief_copy(p_run_id uuid, p_variant integer, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r   public.brief_copy_runs%rowtype;
  b   public.content_briefs%rowtype;
  v   jsonb;
  rev integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into r
    from public.brief_copy_runs x
   where x.id = p_run_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 생성 기록을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if r.status <> 'succeeded' then
    raise exception 'INVALID_TRANSITION: 성공한 생성만 채택할 수 있습니다' using errcode = 'P0001';
  end if;
  if r.accepted_variant is not null then
    raise exception 'INVALID_TRANSITION: 이미 채택한 생성입니다' using errcode = 'P0001';
  end if;
  v := r.variants -> (p_variant - 1);
  if p_variant is null or p_variant < 1 or v is null then
    raise exception 'VALIDATION: 없는 변형 번호입니다' using errcode = '22023';
  end if;
  select x.* into b from public.content_briefs x where x.id = r.brief_id for update;
  if b.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(b.id);
  update public.content_briefs set copy_draft = v ->> 'text', copy_origin = 'ai' where id = b.id returning revision into rev;
  update public.brief_copy_runs set accepted_variant = p_variant, accepted_at = now() where id = r.id;
  perform app.brief_audit(r.workspace_id, r.brief_id, 'copy_accept', rev,
    jsonb_build_object('run_id', r.id, 'variant', p_variant, 'used_claim_ids', v -> 'usedClaimIds'));
  return rev;
end $$;
revoke execute on function public.accept_brief_copy(uuid, integer, integer) from public, anon;
grant execute on function public.accept_brief_copy(uuid, integer, integer) to authenticated;

-- 4-4) 브리프 수정: 22번 정의에서 copy_origin 처리만 바꾼다(위 5번).
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
  draft  text;
  origin text;
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
  -- DEC-08: 'ai' 는 accept_brief_copy 로만 저장한다. 직접 'ai' 를 보내면 거절.
  if p_copy_origin is null or p_copy_origin not in ('manual', 'template') then
    raise exception 'VALIDATION: 알 수 없는 카피 작성 방식입니다' using errcode = '22023';
  end if;
  draft := app.brief_text(p_copy_draft, 5000, '카피 초안');
  -- 지금 AI 초안이고 카피 글을 바꾸지 않았으면 'ai' 를 유지한다(다른 칸만 고친 경우). 글을 바꾸면 보낸 값(manual·template).
  origin := case when b.copy_origin = 'ai' and draft is not distinct from b.copy_draft then 'ai' else p_copy_origin end;
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
         copy_draft = draft,
         copy_origin = origin,
         image_guide = app.brief_text(p_image_guide, 2000, '이미지 가이드'),
         status = p_status
   where id = b.id
   returning revision into r;
  perform app.brief_audit(b.workspace_id, b.id, 'brief_update', r, jsonb_build_object('status', p_status));
  return r;
end $$;
revoke execute on function public.update_content_brief(uuid, integer, text, text, text, text, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.update_content_brief(uuid, integer, text, text, text, text, text, jsonb, text, text, text, text) to authenticated;
