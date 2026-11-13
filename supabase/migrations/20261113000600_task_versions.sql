-- M5 작업 결과 생성·수정·승인 (F02·F03·F05)
-- 여러 테이블을 함께 바꾸는 동작은 함수 하나(트랜잭션 하나)로 처리해 일부만 저장되는 일을 막는다.
-- 모두 호출자 권한(security invoker)이라 RLS가 그대로 적용된다. 남의 작업은 보이지 않으므로 NOT_FOUND.

-- 실행 기록이 만든 결과 버전 (같은 키로 다시 요청하면 이 버전을 돌려준다, T15)
alter table public.generation_runs
  add column artifact_version_id uuid references public.artifact_versions (id);

-- 작업 상태를 목표 상태까지 허용된 길로만 옮긴다. 이미 목표면 그대로.
create or replace function app.move_task(p_task_id uuid, p_path text[]) returns void
language plpgsql as $$
declare
  st text;
  step text;
begin
  select status into st from public.tasks where id = p_task_id;
  foreach step in array p_path loop
    if st = step then
      continue;
    end if;
    if exists (select 1 from app.state_transitions t where t.machine = 'task' and t.from_state = st and t.to_state = step) then
      update public.tasks set status = step where id = p_task_id;
      st := step;
    end if;
  end loop;
end $$;

-- 1) 생성 결과 기록: 입력 스냅샷 + 실행 기록 + 결과 버전 + 작업 상태
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
language plpgsql security invoker as $$
declare
  t           public.tasks%rowtype;
  existing    public.generation_runs%rowtype;
  snap_id     uuid;
  run_id      uuid;
  a_id        uuid;
  v_id        uuid;
  v_no        integer;
begin
  select * into t from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'NOT_FOUND: 작업을 찾을 수 없습니다' using errcode = 'P0002';
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
  values (t.workspace_id, a_id, v_no, p_content, snap_id, p_mode, t.template_id, auth.uid())
  returning id into v_id;

  update public.artifacts set current_draft_version_id = v_id where id = a_id;
  update public.generation_runs set status = 'succeeded', finished_at = now(), artifact_version_id = v_id where id = run_id;

  -- 작업이 끝나지 않았으면 '검토 중'으로. 수정 요청 상태에서 다시 만든 것도 검토로 돌아간다.
  if t.status <> 'completed' then
    perform app.move_task(t.id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (t.workspace_id, 'artifact', a_id, auth.uid(), 'generate', v_no, jsonb_build_object('mode', p_mode, 'version_id', v_id));

  return query select a_id, v_id, v_no, false;
end $$;

-- 2) 직접 수정: 화면이 본 결과물 revision과 같을 때만 새 버전을 만든다 (T13)
create or replace function public.save_manual_version(
  p_artifact_id       uuid,
  p_expected_revision integer,
  p_content           jsonb
) returns table (version_id uuid, version integer)
language plpgsql security invoker as $$
declare
  a      public.artifacts%rowtype;
  base   public.artifact_versions%rowtype;
  v_id   uuid;
  v_no   integer;
begin
  select * into a from public.artifacts where id = p_artifact_id for update;
  if not found then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  select * into base from public.artifact_versions where id = a.current_draft_version_id;

  select coalesce(max(av.version), 0) + 1 into v_no from public.artifact_versions av where av.artifact_id = a.id;
  insert into public.artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator, template_id, created_by)
  values (a.workspace_id, a.id, v_no, p_content, base.input_snapshot_id, 'manual', base.template_id, auth.uid())
  returning id into v_id;

  update public.artifacts set current_draft_version_id = v_id where id = a.id;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (a.workspace_id, 'artifact', a.id, auth.uid(), 'edit', v_no, jsonb_build_object('version_id', v_id));

  return query select v_id, v_no;
end $$;

-- 3) 검토 결정: 지금 최신 초안만 결정할 수 있다 (오래된 화면에서 다른 버전을 승인하는 일 방지)
create or replace function public.decide_version(
  p_artifact_id uuid,
  p_version_id  uuid,
  p_decision    text,
  p_comment     text default null
) returns void
language plpgsql security invoker as $$
declare
  a public.artifacts%rowtype;
begin
  select * into a from public.artifacts where id = p_artifact_id for update;
  if not found then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.current_draft_version_id is distinct from p_version_id then
    raise exception 'CONFLICT: 최신 버전이 아닙니다. 화면을 새로 고쳐 주세요' using errcode = 'P0001';
  end if;
  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'VALIDATION: 알 수 없는 결정입니다' using errcode = '22023';
  end if;

  insert into public.approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision, comment)
  values (a.workspace_id, a.id, p_version_id, auth.uid(), p_decision, nullif(trim(p_comment), ''));

  if p_decision = 'approved' then
    update public.artifacts set approved_version_id = p_version_id where id = a.id;
    perform app.move_task(a.task_id, array['review', 'completed']);
  else
    perform app.move_task(a.task_id, array['review', 'changes_requested']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (a.workspace_id, 'artifact', a.id, auth.uid(), p_decision, jsonb_build_object('version_id', p_version_id));
end $$;

revoke execute on function public.record_generation(uuid, text, text, jsonb, jsonb, jsonb, jsonb, text) from anon, public;
revoke execute on function public.save_manual_version(uuid, integer, jsonb) from anon, public;
revoke execute on function public.decide_version(uuid, uuid, text, text) from anon, public;
grant execute on function public.record_generation(uuid, text, text, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.save_manual_version(uuid, integer, jsonb) to authenticated;
grant execute on function public.decide_version(uuid, uuid, text, text) to authenticated;
grant execute on function app.move_task(uuid, text[]) to authenticated;
