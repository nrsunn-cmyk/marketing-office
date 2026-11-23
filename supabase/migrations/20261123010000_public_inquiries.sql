-- NADAUM-BRAND-BACKEND-01 (3B): 나다움 공개 상담(#contact) 영속 저장과 관리자 확인 계약
-- 계약 문서: Plan/Claude-Backend-20261123/NADAUM-BRAND-BACKEND-01.md
--
-- 원칙
--   1) P4 문의(public.inquiries, 로그인 업무실 전용)와 완전히 분리한 새 표·RPC 다. 서로 참조하지 않는다.
--   2) 표는 익명·로그인 역할이 직접 읽거나 쓸 수 없다(권한 0 + RLS 켬). 접수는 정의자 RPC 하나, 확인은 관리자 RPC 만.
--   3) 앱에는 service_role 이 없다(C05). 그래서 "우리 서버만 아는 값"으로 접수를 가른다:
--      이 migration 이 DB 안에서 무작위 비밀값을 만들어 app.server_secrets('public_inquiry_signing')에 두고,
--      서버는 같은 값을 환경 변수 PUBLIC_INQUIRY_SIGNING_KEY 로 받아 HMAC 서명한다(주인님이 SQL Editor 에서 읽어 Vercel 에 넣는다).
--      키가 없으면 서버가 접수를 끈다(안전한 쪽). 서명 없는 직접 호출(PostgREST)은 BAD_SIGNATURE 로 거절한다.
--   4) 제출 제한: 서버가 접속 IP 로 만든 HMAC 값(client_hash, IP 원문은 DB 에 오지 않음)·전화번호 숫자·전체 시간당 건수.
--   5) 개인정보: 오류 문구·관리자 열람 기록에 이름·전화·내용을 넣지 않는다.
-- 기존 표·함수는 바꾸지 않는다.

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
create table public.public_inquiries (
  id                 uuid primary key default gen_random_uuid(),
  ref_code           text not null unique check (ref_code ~ '^ND-[0-9]{6}-[0-9A-F]{6}$'),
  company_name       text not null check (char_length(company_name) between 1 and 80),
  contact_name       text not null check (char_length(contact_name) between 1 and 40),
  phone              text not null check (char_length(phone) between 1 and 30),
  phone_digits       text not null check (phone_digits ~ '^[0-9]{8,15}$'),
  services           text[] not null check (
                       cardinality(services) between 1 and 7
                       and services <@ array['homepage', 'detail_page', 'short_video', 'logo', 'ad_image', 'sns_content', 'other']::text[]),
  other_service      text check (other_service is null or char_length(other_service) between 1 and 80),
  message            text not null check (char_length(message) between 1 and 2000),
  reference_url      text check (reference_url is null or (char_length(reference_url) <= 300 and reference_url ~* '^https?://[^[:space:]]+$')),
  desired_timeline   text check (desired_timeline is null or char_length(desired_timeline) between 1 and 80),
  budget_range       text check (budget_range is null or char_length(budget_range) between 1 and 80),
  privacy_consent_at timestamptz not null,
  consent_version    text not null check (char_length(consent_version) between 1 and 40),
  client_hash        text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  status             text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'closed')),
  status_changed_at  timestamptz,
  status_changed_by  uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 기타를 고르면 기타 내용이 꼭 있고, 고르지 않으면 없다
  check (('other' = any (services)) = (other_service is not null))
);
create index public_inquiries_created_idx on public.public_inquiries (created_at desc, id desc);
create index public_inquiries_status_created_idx on public.public_inquiries (status, created_at desc, id desc);
create index public_inquiries_client_created_idx on public.public_inquiries (client_hash, created_at desc);
create index public_inquiries_phone_created_idx on public.public_inquiries (phone_digits, created_at desc);

alter table public.public_inquiries enable row level security;
revoke all on public.public_inquiries from public, anon, authenticated;

-- 일회용 번호(같은 서명 요청을 두 번 받지 않는다). 하루 지난 것은 접수 때 지운다.
create table app.public_inquiry_nonces (
  nonce   uuid primary key,
  used_at timestamptz not null default now()
);
revoke all on app.public_inquiry_nonces from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2) 서명 비밀값과 도우미
-- ─────────────────────────────────────────────
insert into app.server_secrets (name, value)
values ('public_inquiry_signing', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'));

-- 제출 제한 숫자(한 곳). 바꿀 때는 이 함수만 새 migration 으로 교체한다.
create or replace function app.public_inquiry_limit(p_name text) returns int
language sql immutable set search_path = '' as $$
  select case p_name
    when 'per_client_10min' then 3
    when 'per_client_day' then 10
    when 'per_phone_day' then 3
    when 'global_hour' then 60
  end
$$;
revoke execute on function app.public_inquiry_limit(text) from public, anon, authenticated;

-- 화면 표시값(한글) → 저장 코드. 모르는 값은 null.
create or replace function app.public_inquiry_service_code(p_label text) returns text
language sql immutable set search_path = '' as $$
  select case p_label
    when '홈페이지 제작' then 'homepage'
    when '상세페이지 제작' then 'detail_page'
    when '쇼츠·릴스 영상' then 'short_video'
    when '로고 제작' then 'logo'
    when '광고·상품 이미지' then 'ad_image'
    when 'SNS 콘텐츠' then 'sns_content'
    when '기타' then 'other'
  end
$$;
revoke execute on function app.public_inquiry_service_code(text) from public, anon, authenticated;

-- 빈칸·공백만이면 null, 아니면 앞뒤 공백을 뗀 값
create or replace function app.public_inquiry_opt(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(coalesce(p, '')), '')
$$;
revoke execute on function app.public_inquiry_opt(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 3) 접수 RPC(익명·로그인 모두 부를 수 있으나 서버 서명이 있어야 받는다)
--    서명 메시지 = 'public_inquiry_submit|' || 서명시각(ms) || '|' || 일회용번호 || '|' || client_hash || '|' || payload(그대로의 글자)
--    payload(JSON 글자): company_name, contact_name, phone, services(한글 표시값 배열), other_service, message,
--                        reference_url, desired_timeline, budget_range, privacy_consent(true), consent_version
-- ─────────────────────────────────────────────
create or replace function public.submit_public_inquiry(
  p_payload     text,
  p_client_hash text,
  p_signed_at   bigint,
  p_nonce       uuid,
  p_signature   text
) returns table (ref_code text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  secret   text;
  now_ms   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  j        jsonb;
  company  text;
  cname    text;
  ph       text;
  digits   text;
  labels   text[];
  codes    text[] := array[]::text[];
  lbl      text;
  code     text;
  other    text;
  msg      text;
  url      text;
  timeline text;
  budget   text;
  cver     text;
  new_id   uuid := gen_random_uuid();
  rc       text;
  v_at     timestamptz := now();
  n        int;
begin
  -- 3-1) 서버 서명
  select s.value into secret from app.server_secrets s where s.name = 'public_inquiry_signing';
  if secret is null then
    raise exception 'NOT_CONFIGURED: 상담 접수 서명 키가 DB 에 없습니다' using errcode = 'P0001';
  end if;
  if p_payload is null or p_client_hash is null or p_signed_at is null or p_nonce is null or p_signature is null
     or lower(p_signature) <> app.hmac_sha256(convert_to(secret, 'UTF8'),
          convert_to('public_inquiry_submit|' || p_signed_at || '|' || p_nonce || '|' || p_client_hash || '|' || p_payload, 'UTF8')) then
    raise exception 'BAD_SIGNATURE: 서버 서명이 맞지 않습니다' using errcode = '42501';
  end if;
  if abs(now_ms - p_signed_at) > 300000 then
    raise exception 'BAD_SIGNATURE: 서명 시각이 너무 오래되었습니다' using errcode = '42501';
  end if;
  if p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: 접속 구분 값이 올바르지 않습니다' using errcode = '22023';
  end if;
  delete from app.public_inquiry_nonces where used_at < now() - interval '1 day';
  insert into app.public_inquiry_nonces (nonce) values (p_nonce) on conflict do nothing;
  if not found then
    raise exception 'BAD_SIGNATURE: 이미 처리한 요청입니다' using errcode = '42501';
  end if;

  -- 3-2) 입력 검증(화면 contact-model.ts 와 같은 규칙. 문구에 입력값을 넣지 않는다)
  begin
    j := p_payload::jsonb;
  exception when others then
    raise exception 'VALIDATION: 접수 내용 형식이 올바르지 않습니다' using errcode = '22023';
  end;
  if jsonb_typeof(j) <> 'object' then
    raise exception 'VALIDATION: 접수 내용 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  company := app.public_inquiry_opt(j ->> 'company_name');
  cname := app.public_inquiry_opt(j ->> 'contact_name');
  ph := app.public_inquiry_opt(j ->> 'phone');
  msg := app.public_inquiry_opt(j ->> 'message');
  url := app.public_inquiry_opt(j ->> 'reference_url');
  timeline := app.public_inquiry_opt(j ->> 'desired_timeline');
  budget := app.public_inquiry_opt(j ->> 'budget_range');
  cver := app.public_inquiry_opt(j ->> 'consent_version');

  if company is null or char_length(company) > 80 then
    raise exception 'VALIDATION: company_name: 업체명은 1~80자로 입력해 주세요' using errcode = '22023';
  end if;
  if cname is null or char_length(cname) > 40 then
    raise exception 'VALIDATION: contact_name: 담당자 이름은 1~40자로 입력해 주세요' using errcode = '22023';
  end if;
  digits := regexp_replace(coalesce(ph, ''), '[^0-9]', '', 'g');
  if ph is null or char_length(ph) > 30 or ph !~ '^[0-9+() -]+$' or char_length(digits) not between 8 and 15 then
    raise exception 'VALIDATION: phone: 연락 가능한 전화번호를 숫자로 입력해 주세요' using errcode = '22023';
  end if;
  if url is not null and (char_length(url) > 300 or url !~* '^https?://[^[:space:]]+$') then
    raise exception 'VALIDATION: reference_url: 참고 URL은 https:// 로 시작하는 주소로 입력해 주세요' using errcode = '22023';
  end if;
  if jsonb_typeof(j -> 'services') is distinct from 'array' then
    raise exception 'VALIDATION: services: 제작 희망 서비스를 1개 이상 선택해 주세요' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), array[]::text[]) into labels from jsonb_array_elements_text(j -> 'services') as t(x);
  if cardinality(labels) = 0 then
    raise exception 'VALIDATION: services: 제작 희망 서비스를 1개 이상 선택해 주세요' using errcode = '22023';
  end if;
  foreach lbl in array labels loop
    code := app.public_inquiry_service_code(lbl);
    if code is null then
      raise exception 'VALIDATION: services: 알 수 없는 서비스가 있습니다' using errcode = '22023';
    end if;
    codes := array_append(codes, code);
  end loop;
  -- 저장 순서는 화면 순서로 고정
  select array_agg(c order by array_position(array['homepage', 'detail_page', 'short_video', 'logo', 'ad_image', 'sns_content', 'other']::text[], c))
    into codes from unnest(codes) as u(c);
  if 'other' = any (codes) then
    other := app.public_inquiry_opt(j ->> 'other_service');
    if other is null or char_length(other) > 80 then
      raise exception 'VALIDATION: other_service: 기타를 선택하셨다면 필요한 제작 내용을 1~80자로 적어 주세요' using errcode = '22023';
    end if;
  else
    other := null;
  end if;
  if msg is null or char_length(msg) > 2000 then
    raise exception 'VALIDATION: message: 요청 내용은 1~2000자로 입력해 주세요' using errcode = '22023';
  end if;
  if timeline is not null and char_length(timeline) > 80 then
    raise exception 'VALIDATION: desired_timeline: 희망 일정은 80자 이내로 입력해 주세요' using errcode = '22023';
  end if;
  if budget is not null and char_length(budget) > 80 then
    raise exception 'VALIDATION: budget_range: 예산 범위는 80자 이내로 입력해 주세요' using errcode = '22023';
  end if;
  if (j -> 'privacy_consent') is distinct from 'true'::jsonb then
    raise exception 'VALIDATION: privacy_consent: 개인정보 수집·이용에 동의해 주세요' using errcode = '22023';
  end if;
  if cver is null or char_length(cver) > 40 then
    raise exception 'VALIDATION: consent_version: 동의 문구 판이 없습니다' using errcode = '22023';
  end if;

  -- 3-3) 제출 제한(같은 접속자는 한 줄로 세워 동시 요청으로 넘지 못하게)
  perform pg_advisory_xact_lock(hashtext('public_inquiry_client:' || p_client_hash));
  perform pg_advisory_xact_lock(hashtext('public_inquiry_phone:' || digits));
  -- 전체 시간당 한도도 동시 요청으로 넘지 않게 전역 잠금(Tester QA-NADAUM-BRAND-BACKEND-01 F1).
  -- 잠금 순서는 언제나 접속자 → 전화 → 전역(교착 없음). 시간당 60건 규모라 한 줄로 세우는 비용은 작다.
  perform pg_advisory_xact_lock(hashtext('public_inquiry_global'));
  select count(*) into n from public.public_inquiries p where p.client_hash = p_client_hash and p.created_at > v_at - interval '10 minutes';
  if n >= app.public_inquiry_limit('per_client_10min') then
    raise exception 'RATE_LIMITED: 잠시 후 다시 시도해 주세요' using errcode = 'P0001';
  end if;
  select count(*) into n from public.public_inquiries p where p.client_hash = p_client_hash and p.created_at > v_at - interval '1 day';
  if n >= app.public_inquiry_limit('per_client_day') then
    raise exception 'RATE_LIMITED: 오늘은 더 접수할 수 없습니다. 내일 다시 시도해 주세요' using errcode = 'P0001';
  end if;
  select count(*) into n from public.public_inquiries p where p.phone_digits = digits and p.created_at > v_at - interval '1 day';
  if n >= app.public_inquiry_limit('per_phone_day') then
    raise exception 'RATE_LIMITED: 같은 연락처로는 오늘 더 접수할 수 없습니다' using errcode = 'P0001';
  end if;
  select count(*) into n from public.public_inquiries p where p.created_at > v_at - interval '1 hour';
  if n >= app.public_inquiry_limit('global_hour') then
    raise exception 'RATE_LIMITED: 지금 접수가 많습니다. 잠시 후 다시 시도해 주세요' using errcode = 'P0001';
  end if;

  -- 3-4) 저장. 참조 번호 = ND-(서울 기준 YYMMDD)-(id 앞 6자리 16진수 대문자)
  rc := 'ND-' || to_char(v_at at time zone 'Asia/Seoul', 'YYMMDD') || '-' || upper(left(replace(new_id::text, '-', ''), 6));
  insert into public.public_inquiries (
    id, ref_code, company_name, contact_name, phone, phone_digits, services, other_service, message,
    reference_url, desired_timeline, budget_range, privacy_consent_at, consent_version, client_hash, created_at, updated_at
  ) values (
    new_id, rc, company, cname, ph, digits, codes, other, msg, url, timeline, budget, v_at, cver, p_client_hash, v_at, v_at
  );
  return query select rc, v_at;
end;
$$;
revoke execute on function public.submit_public_inquiry(text, text, bigint, uuid, text) from public;
grant execute on function public.submit_public_inquiry(text, text, bigint, uuid, text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) 관리자 RPC(관리자가 아니면 FORBIDDEN, 열람·변경마다 admin_access_log 1행 — 개인정보 없이)
-- ─────────────────────────────────────────────
create or replace function public.admin_list_public_inquiries(
  p_status         text default null,
  p_limit          integer default 50,
  p_before_created timestamptz default null,
  p_before_id      uuid default null
) returns table (
  id uuid, ref_code text, created_at timestamptz, status text,
  company_name text, contact_name text, phone text, services text[], other_service text, message text,
  reference_url text, desired_timeline text, budget_range text,
  privacy_consent_at timestamptz, consent_version text, status_changed_at timestamptz, updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  me  uuid := app.assert_admin();
  lim int := least(200, greatest(1, coalesce(p_limit, 50)));
  n   int;
begin
  if p_status is not null and p_status not in ('new', 'contacted', 'quoted', 'closed') then
    raise exception 'VALIDATION: 알 수 없는 상담 상태입니다' using errcode = '22023';
  end if;
  return query
    select q.id, q.ref_code, q.created_at, q.status,
           q.company_name, q.contact_name, q.phone, q.services, q.other_service, q.message,
           q.reference_url, q.desired_timeline, q.budget_range,
           q.privacy_consent_at, q.consent_version, q.status_changed_at, q.updated_at
      from public.public_inquiries q
     where (p_status is null or q.status = p_status)
       and (p_before_created is null
            or (q.created_at, q.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by q.created_at desc, q.id desc
     limit lim;
  get diagnostics n = row_count;
  perform app.admin_log(me, 'admin_list_public_inquiries',
    jsonb_build_object('status', p_status, 'limit', lim, 'before_created', p_before_created, 'before_id', p_before_id), n);
end;
$$;
revoke execute on function public.admin_list_public_inquiries(text, integer, timestamptz, uuid) from public, anon;
grant execute on function public.admin_list_public_inquiries(text, integer, timestamptz, uuid) to authenticated;

create or replace function public.admin_public_inquiry_counts()
returns table (status text, total integer)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := app.assert_admin();
begin
  return query
    select s.st, coalesce((select count(*)::int from public.public_inquiries q where q.status = s.st), 0)
      from unnest(array['new', 'contacted', 'quoted', 'closed']::text[]) with ordinality as s(st, ord)
     order by s.ord;
  perform app.admin_log(me, 'admin_public_inquiry_counts', '{}'::jsonb, 4);
end;
$$;
revoke execute on function public.admin_public_inquiry_counts() from public, anon;
grant execute on function public.admin_public_inquiry_counts() to authenticated;

-- 상태 변경. 화면이 본 상태(p_expected_status)와 지금 상태가 다르면 CONFLICT(다른 관리자가 먼저 바꿈).
create or replace function public.admin_set_public_inquiry_status(p_id uuid, p_status text, p_expected_status text)
returns table (status text, status_changed_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me  uuid := app.assert_admin();
  cur text;
  v_at timestamptz := now();
begin
  if p_status is null or p_status not in ('new', 'contacted', 'quoted', 'closed') then
    raise exception 'VALIDATION: 알 수 없는 상담 상태입니다' using errcode = '22023';
  end if;
  select q.status into cur from public.public_inquiries q where q.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: 상담 접수를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_expected_status is distinct from cur then
    raise exception 'CONFLICT: 다른 관리자가 먼저 상태를 바꿨습니다. 새로 고친 뒤 다시 시도해 주세요' using errcode = 'P0001';
  end if;
  if cur <> p_status then
    update public.public_inquiries q
       set status = p_status, status_changed_at = v_at, status_changed_by = me, updated_at = v_at
     where q.id = p_id;
  end if;
  perform app.admin_log(me, 'admin_set_public_inquiry_status', jsonb_build_object('id', p_id, 'from', cur, 'to', p_status), 1);
  return query select q.status, q.status_changed_at, q.updated_at from public.public_inquiries q where q.id = p_id;
end;
$$;
revoke execute on function public.admin_set_public_inquiry_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_public_inquiry_status(uuid, text, text) to authenticated;
