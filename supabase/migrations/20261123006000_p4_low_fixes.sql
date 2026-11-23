-- P4-LOW-FIXES-R3-BACKEND-01 (006000): P4-SAFETY-REVIEW-01 의 낮은 등급 R4·R7·R8 보완
-- 설계: Plan/Claude-Backend-20261123/P4-R4R7R8-DESIGN-01.md
--   R4 create_inquiry: 출처 종류별로 같은 업무실·프로젝트의 리드 마그넷·웹 문구 문서인지 확인(보관 여부는 보지 않음, E2)
--   R7 upsert_channel_connection: 주소 저장 규칙을 서버 발신 규칙(channel-boundary.ts endpoint())에 맞춤
--   R8 연결·수정·키 교체·해제 감사(audit_events, entity_type 'channel_connection')
--      키 값·주소 원문·금액은 남기지 않는다(관리자 감사 화면이 details 글자값을 그대로 보여 주므로)
-- R6 은 002000(권한 회수)과 기존 external_url 검사 제약으로 닫혀 이 파일에 없다.
-- 기존 함수 이름·인자·반환 형식·실행 권한은 그대로다. 이미 있는 데이터는 바꾸지 않는다(E3).
-- 007000(R3 한도)은 이 판의 create_inquiry 에서 출발한다.

-- ─────────────────────────────────────────────
-- 1) R7 주소 검사 도우미
-- ─────────────────────────────────────────────
create or replace function app.channel_url_ok(p_url text) returns boolean
language sql immutable set search_path = '' as $$
  select p_url is not null
     and char_length(p_url) <= 500
     and p_url ~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/[^?#[:space:]]*)?$'
     and p_url !~ '^https://[0-9.]+(/|$)'
     -- 호스트의 마지막 라벨이 숫자(10진수·0x 16진수·0 시작 8진수)면 서버(WHATWG URL)가 IPv4 로 해석해 막는다.
     -- 같은 기준으로 저장 단계에서도 거절한다(예: 0x7f.1 → 127.0.0.1). 0x7f000001.example.com 처럼 끝이 글자면 통과.
     and regexp_replace(lower(coalesce(substring(p_url from '^https://([^/]+)'), '')), '^.*\.', '') !~ '^(0x[0-9a-f]*|[0-9]+)$'
$$;
revoke execute on function app.channel_url_ok(text) from public, anon, authenticated;

-- 주소에서 호스트만(감사용). 검사를 통과한 주소에만 쓴다.
create or replace function app.channel_url_host(p_url text) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(p_url, '') = '' then '' else lower(coalesce(substring(p_url from '^https://([^/]+)'), '')) end
$$;
revoke execute on function app.channel_url_host(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2) R8 감사 도우미
-- ─────────────────────────────────────────────
create or replace function app.channel_connection_audit(p_ws uuid, p_id uuid, p_action text, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'channel_connection', p_id, auth.uid(), p_action, null, p_details)
$$;
revoke execute on function app.channel_connection_audit(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 3) R4 문의 출처 확인
-- ─────────────────────────────────────────────
create or replace function public.create_inquiry(
  p_project_id uuid, p_source_kind text, p_source_id uuid, p_contact_name text, p_contact_phone text, p_contact_email text, p_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  nm text := app.funnel_trim(p_contact_name);
  inq_id uuid;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects where id = p_project_id and workspace_id = ws and status <> 'archived') then
    raise exception 'INVALID_TRANSITION: 활성 프로젝트에만 문의를 등록할 수 있습니다' using errcode = 'P0001';
  end if;
  if p_source_kind is null or p_source_kind not in ('lead_magnet', 'web_copy_contact', 'manual') then
    raise exception 'VALIDATION: 알 수 없는 접수 출처입니다' using errcode = '22023';
  end if;
  if p_source_kind = 'manual' then
    if p_source_id is not null then
      raise exception 'VALIDATION: 직접 등록한 문의에는 출처를 지정할 수 없습니다' using errcode = '22023';
    end if;
  elsif p_source_id is null then
    raise exception 'VALIDATION: 접수 출처를 지정해 주세요' using errcode = '22023';
  elsif p_source_kind = 'lead_magnet' and not exists (
    select 1 from public.lead_magnets m where m.id = p_source_id and m.workspace_id = ws and m.project_id = p_project_id
  ) then
    raise exception 'NOT_FOUND: 같은 프로젝트의 리드 마그넷만 출처로 지정할 수 있습니다' using errcode = 'P0002';
  elsif p_source_kind = 'web_copy_contact' and not exists (
    select 1 from public.web_copy_docs w where w.id = p_source_id and w.workspace_id = ws and w.project_id = p_project_id
  ) then
    raise exception 'NOT_FOUND: 같은 프로젝트의 웹 문구 문서만 출처로 지정할 수 있습니다' using errcode = 'P0002';
  end if;
  if char_length(nm) < 1 or char_length(nm) > 80 then
    raise exception 'VALIDATION: 문의자 이름은 1~80자여야 합니다' using errcode = '22023';
  end if;
  insert into public.inquiries (
    workspace_id, project_id, source_kind, source_id, contact_name, contact_phone, contact_email, note, created_by
  ) values (
    ws, p_project_id, p_source_kind, p_source_id, nm,
    left(trim(coalesce(p_contact_phone, '')), 40),
    left(trim(coalesce(p_contact_email, '')), 120),
    left(trim(coalesce(p_note, '')), 500),
    uid
  ) returning id into inq_id;
  return inq_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 4) R7·R8 연결 저장
-- ─────────────────────────────────────────────
create or replace function public.upsert_channel_connection(
  p_channel text,
  p_account_label text,
  p_endpoint_url text,
  p_metrics_url text default '',
  p_monthly_budget_won bigint default 0,
  p_per_run_limit_won bigint default 0,
  p_secret_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  lbl text := app.funnel_trim(coalesce(p_account_label, ''));
  ep text := trim(coalesce(p_endpoint_url, ''));
  mp text := trim(coalesce(p_metrics_url, ''));
  sk text := trim(coalesce(p_secret_key, ''));
  bud bigint := coalesce(p_monthly_budget_won, 0);
  per bigint := coalesce(p_per_run_limit_won, 0);
  has_secret boolean := false;
  old public.channel_connections%rowtype;
  had_row boolean := false;
  changed text[] := array[]::text[];
  conn_id uuid;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('crm', 'search_ad', 'social_api') then
    raise exception 'VALIDATION: 외부 채널(crm·search_ad·social_api)만 설정할 수 있습니다' using errcode = '22023';
  end if;
  if char_length(lbl) < 1 or char_length(lbl) > 100 then
    raise exception 'VALIDATION: 계정 표시 이름은 1~100자여야 합니다' using errcode = '22023';
  end if;
  if not app.channel_url_ok(ep) then
    raise exception 'VALIDATION: 실행 연동 주소는 https:// 로 시작하는 도메인 주소여야 합니다(포트·?·# 없이, 500자 이하)' using errcode = '22023';
  end if;
  if mp <> '' and not app.channel_url_ok(mp) then
    raise exception 'VALIDATION: 성과 수집 주소는 https:// 로 시작하는 도메인 주소여야 합니다(포트·?·# 없이, 500자 이하)' using errcode = '22023';
  end if;
  if bud < 0 or per < 0 then
    raise exception 'VALIDATION: 비용 한도는 0원 이상이어야 합니다' using errcode = '22023';
  end if;

  -- 감사를 위해 바꾸기 전 행을 잠그고 읽는다
  select * into old from public.channel_connections c where c.workspace_id = ws and c.channel = p_channel for update;
  had_row := found;

  select exists(select 1 from app.channel_secrets s where s.workspace_id = ws and s.channel = p_channel) into has_secret;
  if sk = '' and not has_secret then
    raise exception 'VALIDATION: 최초 연결 시 API 키 또는 비밀 토큰을 입력해 주세요' using errcode = '22023';
  end if;
  if sk <> '' then
    if char_length(sk) > 500 then
      raise exception 'VALIDATION: API 키는 500자 이하로 입력해 주세요' using errcode = '22023';
    end if;
    insert into app.channel_secrets (workspace_id, channel, secret_value, updated_at)
    values (ws, p_channel, sk, now())
    on conflict (workspace_id, channel) do update
      set secret_value = excluded.secret_value, updated_at = now();
  end if;

  insert into public.channel_connections (
    workspace_id, channel, status, account_label, endpoint_url, metrics_url,
    monthly_budget_won, per_run_limit_won, last_checked_at, last_error_code, created_by
  )
  values (ws, p_channel, 'connected', lbl, ep, mp, bud, per, now(), null, uid)
  on conflict (workspace_id, channel) do update
    set status = 'connected',
        account_label = excluded.account_label,
        endpoint_url = excluded.endpoint_url,
        metrics_url = excluded.metrics_url,
        monthly_budget_won = excluded.monthly_budget_won,
        per_run_limit_won = excluded.per_run_limit_won,
        last_checked_at = now(),
        last_error_code = null,
        updated_at = now()
  returning id into conn_id;

  -- R8 감사(키 값·주소 원문·금액은 남기지 않는다)
  if not had_row or old.status <> 'connected' then
    perform app.channel_connection_audit(ws, conn_id, 'channel_connected', jsonb_build_object(
      'channel', p_channel, 'endpoint_host', app.channel_url_host(ep), 'metrics_host', app.channel_url_host(mp), 'secret_set', true));
  else
    if old.account_label is distinct from lbl then changed := array_append(changed, 'account_label'); end if;
    if old.endpoint_url is distinct from ep then changed := array_append(changed, 'endpoint_url'); end if;
    if old.metrics_url is distinct from mp then changed := array_append(changed, 'metrics_url'); end if;
    if old.monthly_budget_won is distinct from bud then changed := array_append(changed, 'monthly_budget_won'); end if;
    if old.per_run_limit_won is distinct from per then changed := array_append(changed, 'per_run_limit_won'); end if;
    if cardinality(changed) > 0 then
      perform app.channel_connection_audit(ws, conn_id, 'channel_updated', jsonb_build_object(
        'channel', p_channel, 'changed', to_jsonb(changed),
        'endpoint_host', app.channel_url_host(ep), 'metrics_host', app.channel_url_host(mp)));
    end if;
    if sk <> '' and has_secret then
      perform app.channel_connection_audit(ws, conn_id, 'channel_secret_rotated', jsonb_build_object('channel', p_channel));
    end if;
  end if;

  return conn_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 5) R8 연결 해제
-- ─────────────────────────────────────────────
create or replace function public.disconnect_channel_connection(p_channel text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  conn_id uuid;
  old_status text;
  removed int := 0;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('crm', 'search_ad', 'social_api') then
    raise exception 'VALIDATION: 알 수 없는 외부 채널입니다' using errcode = '22023';
  end if;

  select c.id, c.status into conn_id, old_status
    from public.channel_connections c where c.workspace_id = ws and c.channel = p_channel for update;

  delete from app.channel_secrets where workspace_id = ws and channel = p_channel;
  get diagnostics removed = row_count;
  update public.channel_connections
     set status = 'disconnected',
         last_error_code = null,
         updated_at = now()
   where workspace_id = ws and channel = p_channel;

  -- 행이 있고, 실제로 바뀐 것(연결 상태였거나 키가 있었음)이 있을 때만 남긴다
  if conn_id is not null and (old_status <> 'disconnected' or removed > 0) then
    perform app.channel_connection_audit(ws, conn_id, 'channel_disconnected', jsonb_build_object(
      'channel', p_channel, 'secret_removed', removed > 0));
  end if;
  return true;
end;
$$;

-- ─────────────────────────────────────────────
-- 6) 실행 권한(기존과 같은 방식)
-- ─────────────────────────────────────────────
revoke execute on function
  public.create_inquiry(uuid, text, uuid, text, text, text, text),
  public.upsert_channel_connection(text, text, text, text, bigint, bigint, text),
  public.disconnect_channel_connection(text)
from public, anon;

grant execute on function
  public.create_inquiry(uuid, text, uuid, text, text, text, text),
  public.upsert_channel_connection(text, text, text, text, bigint, bigint, text),
  public.disconnect_channel_connection(text)
to authenticated;
