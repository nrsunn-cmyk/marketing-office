-- M6 견적 초안 저장·확정 (F04)
-- 확정할 때 DB가 금액을 직접 다시 계산해 화면·서버가 보낸 값과 다르면 거절한다 (금액 오류는 P0 결함).
-- 계산 규칙은 src/domain/quote/calculate.ts 와 같다: 수량 100배 정수, 세율 만분율, 원 단위 사사오입.

-- 0 이상 정수 n/d 사사오입
create or replace function app.round_half_up_div(n numeric, d numeric) returns numeric
language sql immutable as $$
  select floor((2 * n + d) / (2 * d))
$$;

-- 1) 초안 저장 (견적처럼 사람이 직접 입력하는 결과물). 화면이 본 revision과 같을 때만 저장한다.
create or replace function public.save_draft_version(
  p_task_id           uuid,
  p_expected_revision integer,
  p_input_hash        text,
  p_snapshot          jsonb,
  p_content           jsonb
) returns table (artifact_id uuid, version_id uuid, version integer)
language plpgsql security invoker as $$
declare
  t      public.tasks%rowtype;
  a      public.artifacts%rowtype;
  snap   uuid;
  v_id   uuid;
  v_no   integer;
begin
  select * into t from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'NOT_FOUND: 작업을 찾을 수 없습니다' using errcode = 'P0002';
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
  values (t.workspace_id, a.id, v_no, p_content, snap, 'manual', t.template_id, auth.uid())
  returning id into v_id;

  update public.artifacts set current_draft_version_id = v_id where id = a.id;
  if t.status <> 'completed' then
    perform app.move_task(t.id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision)
  values (t.workspace_id, 'artifact', a.id, auth.uid(), 'save_draft', v_no);

  return query select a.id, v_id, v_no;
end $$;

-- 2) 견적 확정: 금액 검증 → 견적 번호 → 고정 기록(quote_versions·quote_items) → 승인·작업 완료
create or replace function public.finalize_quote(
  p_artifact_id         uuid,
  p_version_id          uuid,
  p_supplier_profile_id uuid,
  p_supplier_snapshot   jsonb,
  p_customer_snapshot   jsonb,
  p_tax_mode            text,
  p_tax_rate_bp         integer,
  p_subtotal_won        bigint,
  p_tax_won             bigint,
  p_total_won           bigint,
  p_issue_date          date,
  p_valid_until         date,
  p_payment_terms       text,
  p_notes               text,
  p_items               jsonb
) returns table (quote_id uuid, quote_version_id uuid, quote_number text, reused boolean)
language plpgsql security invoker as $$
declare
  a        public.artifacts%rowtype;
  q_id     uuid;
  qv_id    uuid;
  num      text;
  item     jsonb;
  qty      numeric;
  price    numeric;
  line     numeric;
  sum_line numeric := 0;
  sub      numeric;
  tax      numeric;
  total    numeric;
  pos      integer := 0;
begin
  select * into a from public.artifacts where id = p_artifact_id for update;
  if not found or a.type <> 'quote' then
    raise exception 'NOT_FOUND: 견적을 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  -- 같은 버전을 다시 확정하면 기존 결과 (중복 클릭 안전)
  select qv.id, qv.quote_id, q.quote_number into qv_id, q_id, num
    from public.quote_versions qv join public.quotes q on q.id = qv.quote_id
   where qv.artifact_version_id = p_version_id;
  if found then
    return query select q_id, qv_id, num, true;
    return;
  end if;

  if a.current_draft_version_id is distinct from p_version_id then
    raise exception 'CONFLICT: 최신 버전이 아닙니다. 화면을 새로 고쳐 주세요' using errcode = 'P0001';
  end if;
  if p_tax_mode not in ('EXCLUSIVE', 'INCLUSIVE', 'NO_TAX') or p_tax_rate_bp is null or p_tax_rate_bp < 0 or p_tax_rate_bp > 10000 then
    raise exception 'VALIDATION: 세금 방식·세율이 올바르지 않습니다' using errcode = '22023';
  end if;
  if p_tax_mode = 'NO_TAX' and p_tax_rate_bp <> 0 then
    raise exception 'VALIDATION: 세액 미적용은 세율 0이어야 합니다' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION: 견적 항목이 없습니다' using errcode = '22023';
  end if;
  if p_issue_date is null then
    raise exception 'VALIDATION: 작성일이 필요합니다' using errcode = '22023';
  end if;

  -- 금액 다시 계산
  for item in select value from jsonb_array_elements(p_items) loop
    qty := (item ->> 'quantity_hundredths')::numeric;
    price := (item ->> 'unit_price_won')::numeric;
    if coalesce(trim(item ->> 'name'), '') = '' or qty is null or qty <= 0 or price is null or price < 0
       or qty <> trunc(qty) or price <> trunc(price) then
      raise exception 'VALIDATION: %번째 항목이 올바르지 않습니다', pos + 1 using errcode = '22023';
    end if;
    line := app.round_half_up_div(qty * price, 100);
    if line <> (item ->> 'line_amount_won')::numeric then
      raise exception 'AMOUNT_MISMATCH: %번째 항목 금액이 맞지 않습니다', pos + 1 using errcode = 'P0001';
    end if;
    sum_line := sum_line + line;
    pos := pos + 1;
  end loop;

  if p_tax_mode = 'INCLUSIVE' then
    total := sum_line;
    sub := app.round_half_up_div(total * 10000, 10000 + p_tax_rate_bp);
    tax := total - sub;
  else
    sub := sum_line;
    tax := case when p_tax_mode = 'EXCLUSIVE' then app.round_half_up_div(sub * p_tax_rate_bp, 10000) else 0 end;
    total := sub + tax;
  end if;
  if sub <> p_subtotal_won or tax <> p_tax_won or total <> p_total_won then
    raise exception 'AMOUNT_MISMATCH: 합계가 맞지 않습니다 (계산 %/%/%)', sub, tax, total using errcode = 'P0001';
  end if;

  select q.id into q_id from public.quotes q where q.artifact_id = a.id;
  if not found then
    insert into public.quotes (workspace_id, task_id, artifact_id)
    values (a.workspace_id, a.task_id, a.id)
    returning id into q_id;
  end if;
  num := public.assign_quote_number(q_id, p_issue_date);

  insert into public.quote_versions (
    workspace_id, quote_id, artifact_id, artifact_version_id, supplier_profile_id, supplier_snapshot, customer_snapshot,
    tax_mode, tax_rate_bp, subtotal_won, tax_won, total_won, issue_date, valid_until, payment_terms, notes)
  values (
    a.workspace_id, q_id, a.id, p_version_id, p_supplier_profile_id, p_supplier_snapshot, p_customer_snapshot,
    p_tax_mode, p_tax_rate_bp, sub, tax, total, p_issue_date, p_valid_until,
    nullif(trim(p_payment_terms), ''), nullif(trim(p_notes), ''))
  returning id into qv_id;

  insert into public.quote_items (workspace_id, quote_version_id, position, name, description, quantity_hundredths, unit_price_won, line_amount_won)
  select a.workspace_id, qv_id, (e.ord - 1)::integer, trim(e.value ->> 'name'), nullif(trim(e.value ->> 'description'), ''),
         (e.value ->> 'quantity_hundredths')::bigint, (e.value ->> 'unit_price_won')::bigint, (e.value ->> 'line_amount_won')::bigint
    from jsonb_array_elements(p_items) with ordinality as e(value, ord);

  perform public.decide_version(a.id, p_version_id, 'approved', '견적 확정 ' || num);

  return query select q_id, qv_id, num, false;
end $$;

revoke execute on function public.save_draft_version(uuid, integer, text, jsonb, jsonb) from anon, public;
revoke execute on function public.finalize_quote(uuid, uuid, uuid, jsonb, jsonb, text, integer, bigint, bigint, bigint, date, date, text, text, jsonb) from anon, public;
grant execute on function public.save_draft_version(uuid, integer, text, jsonb, jsonb) to authenticated;
grant execute on function public.finalize_quote(uuid, uuid, uuid, jsonb, jsonb, text, integer, bigint, bigint, bigint, date, date, text, text, jsonb) to authenticated;
grant execute on function app.round_half_up_div(numeric, numeric) to authenticated;
