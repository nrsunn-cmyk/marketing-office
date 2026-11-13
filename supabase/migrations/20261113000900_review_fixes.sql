-- Codex 검수 수정 (2026-11-13 M2~M8 통합 검수)
--
-- CR03: 확정 견적은 finalize_quote 한 경로로만 만들어진다.
--   로그인 사용자의 직접 INSERT(quote_versions·quote_items·quotes·견적 번호)를 막고,
--   finalize_quote 는 정의자 권한(security definer)으로 실행하되 함수 안에서 업무실 주인인지 직접 확인한다.
-- CR04: 결과 버전이 가리키는 입력 스냅샷은 같은 작업의 것이어야 한다(다른 고객 작업의 스냅샷 연결 금지).

-- ─────────────────────────────────────────────
-- CR03
-- ─────────────────────────────────────────────
drop policy if exists quote_versions_insert on public.quote_versions;
drop policy if exists quote_items_insert on public.quote_items;
drop policy if exists quotes_insert on public.quotes;
drop policy if exists quotes_update on public.quotes;
drop policy if exists quote_number_sequences_insert on public.quote_number_sequences;
drop policy if exists quote_number_sequences_update on public.quote_number_sequences;

-- 견적 번호 발번은 확정 함수 안에서만 쓴다
revoke execute on function public.assign_quote_number(uuid, date) from authenticated;

-- 정의자 권한으로 바뀌었으므로 함수 맨 앞에서 주인 확인을 다시 한다 (본문 재정의)
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
language plpgsql security definer set search_path = public, app, pg_temp as $$
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
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into a from public.artifacts where id = p_artifact_id for update;
  -- 정의자 권한은 RLS를 거치지 않으므로 업무실 주인인지 직접 확인한다
  if not found or a.type <> 'quote'
     or not exists (select 1 from public.workspaces w where w.id = a.workspace_id and w.owner_user_id = auth.uid()) then
    raise exception 'NOT_FOUND: 견적을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_supplier_profile_id is not null and not exists (
    select 1 from public.supplier_profiles s where s.id = p_supplier_profile_id and s.workspace_id = a.workspace_id
  ) then
    raise exception 'VALIDATION: 공급자 정보가 올바르지 않습니다' using errcode = '22023';
  end if;

  select qv.id, qv.quote_id, q.quote_number into qv_id, q_id, num
    from public.quote_versions qv join public.quotes q on q.id = qv.quote_id
   where qv.artifact_version_id = p_version_id and qv.artifact_id = a.id;
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

revoke execute on function public.finalize_quote(uuid, uuid, uuid, jsonb, jsonb, text, integer, bigint, bigint, bigint, date, date, text, text, jsonb) from anon, public;
grant execute on function public.finalize_quote(uuid, uuid, uuid, jsonb, jsonb, text, integer, bigint, bigint, bigint, date, date, text, text, jsonb) to authenticated;

-- ─────────────────────────────────────────────
-- CR04
-- ─────────────────────────────────────────────
create or replace function app.check_version_source() returns trigger
language plpgsql as $$
declare
  art_task uuid;
  art_ws   uuid;
  snap_task uuid;
begin
  select a.task_id, a.workspace_id into art_task, art_ws from public.artifacts a where a.id = new.artifact_id;
  if new.workspace_id is distinct from art_ws then
    raise exception 'SOURCE_MISMATCH: 결과물과 다른 업무실의 버전입니다' using errcode = 'P0001';
  end if;
  if new.input_snapshot_id is not null then
    select s.task_id into snap_task from public.task_input_snapshots s where s.id = new.input_snapshot_id;
    if snap_task is distinct from art_task then
      raise exception 'SOURCE_MISMATCH: 다른 작업의 입력 스냅샷은 연결할 수 없습니다' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger artifact_versions_source
  before insert on public.artifact_versions
  for each row execute function app.check_version_source();
