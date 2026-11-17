-- SEC-AUDIT-FIX-02 S1: 소유를 확인하기 전에 남의 행을 잠그던 문제 수정 (QA-SEC-AUDIT-02 3절 S1)
--
-- 문제
--   20261117003000 에서 정의자로 바꾼 record_generation·save_manual_version·save_draft_version 이
--   id 만으로 "select … for update" 한 뒤에 소유를 확인했다. 정의자 함수는 RLS 를 받지 않으므로
--   다른 업무실의 행도 잠깐 잠긴다. 응답 시간으로 행의 존재·사용 중 여부를 추정할 수 있고,
--   반복 호출하면 주인의 쓰기가 밀린다. R1(20261116002000)에서 decide_version 에 고친 것과 같은 결함 유형이다.
--
-- 고치는 것
--   소유 조건을 WHERE 에 넣고 "for update of x" 로 그 표의 행만 잠근다(R1·P2 정의자 함수와 같은 방식).
--   남의 행·없는 행은 아예 고르지 않으므로 잠그지 않고 바로 NOT_FOUND(P0002).
--
-- 바뀌지 않는 것: 그 밖의 본문은 20261117003000 과 한 글자도 다르지 않다(인자·반환·오류 코드·전략 거절·
--   상태 이동·감사 기록). 실행 권한·search_path 도 같다. 기존 마이그레이션 파일은 고치지 않았다.

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
  select x.* into t
    from public.tasks x
   where x.id = p_task_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
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
  select x.* into a
    from public.artifacts x
   where x.id = p_artifact_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
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
  select x.* into t
    from public.tasks x
   where x.id = p_task_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
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
