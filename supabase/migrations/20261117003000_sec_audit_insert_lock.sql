-- SEC-AUDIT-01 감사 기록(audit_events) 직접 추가 차단 (SEC-FIX-01 머리말의 "남는 위험" 해소)
--
-- 문제
--   SEC-FIX-01(20261116001000)은 approvals·delivery_records 직접 INSERT 를 막았지만,
--   audit_events 는 호출자 권한(invoker) RPC 4개가 쓰기 때문에 직접 INSERT 정책을 남겼다.
--   그래서 로그인 사용자가 API 로 자기 이름(actor = 본인)의 가짜 감사 기록을 넣을 수 있었다.
--
-- 고치는 것
--   1) 감사 기록을 쓰는 invoker RPC 4개를 정의자 권한(security definer)으로 바꾼다.
--      setup_workspace · record_generation · save_manual_version · save_draft_version
--      → 본문 규칙(인자·반환·오류 코드·상태 이동)은 그대로 두고, RLS 대신 함수 첫머리에서 직접 확인한다.
--   2) audit_events 의 직접 INSERT 정책을 없애고 authenticated 의 INSERT 권한도 회수한다.
--      → 감사 기록은 정의자 RPC 안에서만 생긴다. service_role(관리 역할)은 그대로 쓸 수 있다.
--
-- 정의자 전환의 안전 조건 (SEC-FIX-01 과 같은 방식)
--   - search_path 를 빈 값으로 고정하고 모든 이름을 스키마까지 적는다.
--   - auth.uid() 가 없으면 NOT_AUTHENTICATED(42501).
--   - 대상 작업·결과물이 그 사용자의 업무실이 아니면 NOT_FOUND(P0002). 남의 것이 있는지 알려 주지 않는다.
--   - 쓰는 행의 workspace_id 는 모두 확인된 작업·결과물에서 가져온다(인자로 받지 않는다).
--   - 전략(strategy) 유형 차단: app.reject_direct_strategy_write 트리거는 current_user 가
--     authenticated/anon 일 때만 막는다. 정의자 함수 안에서는 current_user 가 함수 소유자라 통과하므로,
--     P1 RPC 로 전략 자료를 우회 저장하지 못하게 함수 안에서 같은 오류로 직접 거절한다.
--   - 행위자(actor_id·created_by)는 auth.uid() 를 그대로 쓴다. app.enforce_actor 트리거도 계속 검사한다.
--   - public·anon 실행 권한 회수, authenticated 에게만 실행 권한.
--
-- 바뀌지 않는 것: 인자·반환 형식, CONFLICT·IDEMPOTENCY_MISMATCH·INVALID_TRANSITION·VALIDATION 규칙,
--   승인본 포인터(approved_version_id)는 건드리지 않음, 기존 마이그레이션 파일은 고치지 않음.

-- ─────────────────────────────────────────────
-- 1) setup_workspace (본문 규칙: 20261113000400)
-- ─────────────────────────────────────────────
create or replace function public.setup_workspace(
  p_name            text,
  p_legal_name      text,
  p_representative  text default null,
  p_business_number text default null,
  p_phone           text default null,
  p_email           text default null,
  p_address         text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_legal_name), '') = '' then
    raise exception 'VALIDATION: 업무실 이름과 상호는 필수입니다' using errcode = '22023';
  end if;

  -- 정의자 권한은 RLS를 받지 않으므로 본인 업무실만 찾도록 조건을 직접 건다
  select w.id into ws from public.workspaces w where w.owner_user_id = uid;
  if found then
    return ws;
  end if;

  insert into public.workspaces (owner_user_id, name)
       values (uid, trim(p_name))
    returning id into ws;

  insert into public.supplier_profiles
         (workspace_id, version, legal_name, representative, business_number, phone, email, address)
  values (ws, 1, trim(p_legal_name), nullif(trim(p_representative), ''), nullif(trim(p_business_number), ''),
          nullif(trim(p_phone), ''), nullif(trim(p_email), ''), nullif(trim(p_address), ''));

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action)
       values (ws, 'workspace', ws, uid, 'setup');

  return ws;
end $$;

revoke execute on function public.setup_workspace(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.setup_workspace(text, text, text, text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────
-- 2) record_generation (본문 규칙: 20261113000600)
-- ─────────────────────────────────────────────
create or replace function public.record_generation(
  p_task_id          uuid,
  p_idempotency_key  text,
  p_input_hash       text,
  p_profile_snapshot jsonb,
  p_extra_inputs     jsonb,
  p_source_refs      jsonb,
  p_content          jsonb,
  p_mode             text
) returns table (artifact_id uuid, version_id uuid, version integer, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  uid         uuid := auth.uid();
  t           public.tasks%rowtype;
  existing    public.generation_runs%rowtype;
  snap_id     uuid;
  run_id      uuid;
  a_id        uuid;
  v_id        uuid;
  v_no        integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select * into t from public.tasks where id = p_task_id for update;
  if not found or not exists (
    select 1 from public.workspaces w where w.id = t.workspace_id and w.owner_user_id = uid
  ) then
    raise exception 'NOT_FOUND: 작업을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if t.type = 'strategy' then
    raise exception 'DIRECT_WRITE_FORBIDDEN: 전략 자료는 정해진 기능(RPC)으로만 저장할 수 있습니다' using errcode = '42501';
  end if;
  if t.status = 'cancelled' then
    raise exception 'INVALID_TRANSITION: 취소된 작업입니다' using errcode = 'P0001';
  end if;
  if p_mode <> 'template' then
    raise exception 'VALIDATION: 지원하지 않는 생성 방식입니다' using errcode = '22023';
  end if;

  -- 같은 키 재요청: 내용이 같으면 기존 결과, 다르면 충돌
  select * into existing from public.generation_runs g
   where g.task_id = p_task_id and g.action = 'generate' and g.idempotency_key = p_idempotency_key;
  if found then
    if existing.input_hash <> p_input_hash then
      raise exception 'IDEMPOTENCY_MISMATCH: 같은 요청 키로 다른 내용이 들어왔습니다' using errcode = 'P0001';
    end if;
    return query
      select av.artifact_id, av.id, av.version, true
        from public.artifact_versions av where av.id = existing.artifact_version_id;
    return;
  end if;

  insert into public.task_input_snapshots (workspace_id, task_id, profile_snapshot, extra_inputs, source_version_refs, input_hash)
  values (t.workspace_id, t.id, p_profile_snapshot, p_extra_inputs, p_source_refs, p_input_hash)
  returning id into snap_id;

  insert into public.generation_runs (workspace_id, task_id, action, idempotency_key, input_hash, status, mode, started_at)
  values (t.workspace_id, t.id, 'generate', p_idempotency_key, p_input_hash, 'running', p_mode, now())
  returning id into run_id;

  select a.id into a_id from public.artifacts a where a.task_id = t.id for update;
  if not found then
    insert into public.artifacts (workspace_id, project_id, task_id, type)
    values (t.workspace_id, t.project_id, t.id, t.type)
    returning id into a_id;
  end if;

  select coalesce(max(av.version), 0) + 1 into v_no from public.artifact_versions av where av.artifact_id = a_id;
  insert into public.artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator, template_id, created_by)
  values (t.workspace_id, a_id, v_no, p_content, snap_id, p_mode, t.template_id, uid)
  returning id into v_id;

  update public.artifacts set current_draft_version_id = v_id where id = a_id;
  update public.generation_runs set status = 'succeeded', finished_at = now(), artifact_version_id = v_id where id = run_id;

  if t.status <> 'completed' then
    perform app.move_task(t.id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (t.workspace_id, 'artifact', a_id, uid, 'generate', v_no, jsonb_build_object('mode', p_mode, 'version_id', v_id));

  return query select a_id, v_id, v_no, false;
end $$;

revoke execute on function public.record_generation(uuid, text, text, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_generation(uuid, text, text, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────
-- 3) save_manual_version (본문 규칙: 20261116003000)
-- ─────────────────────────────────────────────
create or replace function public.save_manual_version(
  p_artifact_id       uuid,
  p_expected_revision integer,
  p_content           jsonb
) returns table (version_id uuid, version integer)
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  a      public.artifacts%rowtype;
  base   public.artifact_versions%rowtype;
  st     text;
  v_id   uuid;
  v_no   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select * into a from public.artifacts where id = p_artifact_id for update;
  if not found or not exists (
    select 1 from public.workspaces w where w.id = a.workspace_id and w.owner_user_id = uid
  ) then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.type = 'strategy' then
    raise exception 'DIRECT_WRITE_FORBIDDEN: 전략 자료는 정해진 기능(RPC)으로만 저장할 수 있습니다' using errcode = '42501';
  end if;
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;

  select * into base from public.artifact_versions where id = a.current_draft_version_id;
  select coalesce(max(av.version), 0) + 1 into v_no from public.artifact_versions av where av.artifact_id = a.id;

  insert into public.artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator, template_id, created_by)
  values (a.workspace_id, a.id, v_no, p_content, base.input_snapshot_id, 'manual', base.template_id, uid)
  returning id into v_id;

  update public.artifacts set current_draft_version_id = v_id where id = a.id;

  select t.status into st from public.tasks t where t.id = a.task_id for update;
  if st <> 'completed' then
    perform app.move_task(a.task_id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (a.workspace_id, 'artifact', a.id, uid, 'edit', v_no, jsonb_build_object('version_id', v_id));

  return query select v_id, v_no;
end $$;

revoke execute on function public.save_manual_version(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_manual_version(uuid, integer, jsonb) to authenticated;

-- ─────────────────────────────────────────────
-- 4) save_draft_version (본문 규칙: 20261113000700)
-- ─────────────────────────────────────────────
create or replace function public.save_draft_version(
  p_task_id           uuid,
  p_expected_revision integer,
  p_input_hash        text,
  p_snapshot          jsonb,
  p_content           jsonb
) returns table (artifact_id uuid, version_id uuid, version integer)
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  t      public.tasks%rowtype;
  a      public.artifacts%rowtype;
  snap   uuid;
  v_id   uuid;
  v_no   integer;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select * into t from public.tasks where id = p_task_id for update;
  if not found or not exists (
    select 1 from public.workspaces w where w.id = t.workspace_id and w.owner_user_id = uid
  ) then
    raise exception 'NOT_FOUND: 작업을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if t.type = 'strategy' then
    raise exception 'DIRECT_WRITE_FORBIDDEN: 전략 자료는 정해진 기능(RPC)으로만 저장할 수 있습니다' using errcode = '42501';
  end if;
  if t.status = 'cancelled' then
    raise exception 'INVALID_TRANSITION: 취소된 작업입니다' using errcode = 'P0001';
  end if;

  select * into a from public.artifacts where task_id = t.id for update;
  if found then
    if p_expected_revision is null or a.revision <> p_expected_revision then
      raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
    end if;
  else
    if p_expected_revision is not null then
      raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
    end if;
    insert into public.artifacts (workspace_id, project_id, task_id, type)
    values (t.workspace_id, t.project_id, t.id, t.type)
    returning * into a;
  end if;

  insert into public.task_input_snapshots (workspace_id, task_id, profile_snapshot, extra_inputs, input_hash)
  values (t.workspace_id, t.id, p_snapshot, '{}'::jsonb, p_input_hash)
  returning id into snap;

  select coalesce(max(av.version), 0) + 1 into v_no from public.artifact_versions av where av.artifact_id = a.id;
  insert into public.artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator, template_id, created_by)
  values (t.workspace_id, a.id, v_no, p_content, snap, 'manual', t.template_id, uid)
  returning id into v_id;

  update public.artifacts set current_draft_version_id = v_id where id = a.id;
  if t.status <> 'completed' then
    perform app.move_task(t.id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision)
  values (t.workspace_id, 'artifact', a.id, uid, 'save_draft', v_no);

  return query select a.id, v_id, v_no;
end $$;

revoke execute on function public.save_draft_version(uuid, integer, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_draft_version(uuid, integer, text, jsonb, jsonb) to authenticated;

-- ─────────────────────────────────────────────
-- 5) 감사 기록 직접 INSERT 차단
--    정책을 없애면 RLS 가 막고, 권한 회수로 한 번 더 막는다(정책이 실수로 다시 생겨도 거절).
--    SELECT 정책·권한은 그대로 둔다(본인 업무실 기록 읽기).
-- ─────────────────────────────────────────────
drop policy if exists audit_events_insert on public.audit_events;
revoke insert on public.audit_events from authenticated, anon;
