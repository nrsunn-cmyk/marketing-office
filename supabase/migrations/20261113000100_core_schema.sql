-- M2 핵심 스키마 (P1)
-- 기준: Codex 04 §2~§4, Claude 개발계획 C01~C04·C08·C10
--
-- 원칙
-- 1. 모든 업무 행은 workspace_id를 가진다(RLS 기준).
-- 2. 고객·프로젝트·작업 소속은 복합 외래키로 DB에서 강제한다(C03). 앱 코드만 믿지 않는다.
-- 3. 버전·스냅샷·승인·감사 기록은 추가만 가능하다(C04).
-- 4. 수정 가능한 행은 revision으로 낙관적 잠금을 한다(update ... where revision = 기대값).
-- 5. 상태 전이는 app.state_transitions 표로 검사한다. 이 표는 src/domain/state 와 같아야 한다(테스트로 확인).

create schema if not exists app;

-- ─────────────────────────────────────────────
-- 공통 트리거 함수
-- ─────────────────────────────────────────────

-- 추가 전용 테이블: UPDATE·DELETE 거부
create or replace function app.reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_ROW: % 는 수정·삭제할 수 없습니다', tg_table_name
    using errcode = 'P0001';
end $$;

-- 수정 가능한 테이블: 고정 컬럼 변경 거부 + revision·updated_at 자동 갱신
-- 인자: 변경을 막을 컬럼 이름들
create or replace function app.guard_update() returns trigger
language plpgsql as $$
declare
  col text;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  foreach col in array tg_argv loop
    if new_row -> col is distinct from old_row -> col then
      raise exception 'FROZEN_COLUMN: %.% 는 바꿀 수 없습니다', tg_table_name, col
        using errcode = 'P0001';
    end if;
  end loop;
  if old_row ? 'revision' then
    new.revision := old.revision + 1;
  end if;
  if old_row ? 'updated_at' then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────
-- 상태 정의와 전이표
-- ─────────────────────────────────────────────

create table app.machine_states (
  machine text not null,
  state   text not null,
  primary key (machine, state)
);

create table app.state_transitions (
  machine    text not null,
  from_state text not null,
  to_state   text not null,
  primary key (machine, from_state, to_state),
  foreign key (machine, from_state) references app.machine_states (machine, state),
  foreign key (machine, to_state)   references app.machine_states (machine, state)
);

insert into app.machine_states (machine, state) values
  ('project','received'), ('project','waiting_material'), ('project','active'), ('project','review'),
  ('project','delivered'), ('project','completed'), ('project','archived'),
  ('task','draft'), ('task','waiting_material'), ('task','ready'), ('task','running'), ('task','review'),
  ('task','changes_requested'), ('task','failed'), ('task','completed'), ('task','cancelled'),
  ('extraction','uploaded'), ('extraction','extraction_pending'), ('extraction','extraction_failed'), ('extraction','extracted'),
  ('export','pending'), ('export','rendering'), ('export','failed'), ('export','ready');

insert into app.state_transitions (machine, from_state, to_state) values
  ('project','received','waiting_material'), ('project','received','active'), ('project','received','archived'),
  ('project','waiting_material','active'), ('project','waiting_material','archived'),
  ('project','active','waiting_material'), ('project','active','review'), ('project','active','archived'),
  ('project','review','active'), ('project','review','delivered'),
  ('project','delivered','active'), ('project','delivered','completed'),
  ('project','completed','archived'),
  ('project','archived','active'),
  ('task','draft','waiting_material'), ('task','draft','ready'), ('task','draft','cancelled'),
  ('task','waiting_material','ready'), ('task','waiting_material','cancelled'),
  ('task','ready','running'), ('task','ready','review'), ('task','ready','waiting_material'), ('task','ready','cancelled'),
  ('task','running','review'), ('task','running','failed'),
  ('task','review','changes_requested'), ('task','review','completed'),
  ('task','changes_requested','ready'), ('task','changes_requested','running'), ('task','changes_requested','review'), ('task','changes_requested','cancelled'),
  ('task','failed','ready'), ('task','failed','running'), ('task','failed','cancelled'),
  ('extraction','uploaded','extraction_pending'),
  ('extraction','extraction_pending','extracted'), ('extraction','extraction_pending','extraction_failed'),
  ('extraction','extraction_failed','extraction_pending'),
  ('export','pending','rendering'), ('export','pending','failed'),
  ('export','rendering','ready'), ('export','rendering','failed'),
  ('export','failed','pending');

-- 인자: (기계 이름, 상태 컬럼 이름)
create or replace function app.enforce_state() returns trigger
language plpgsql as $$
declare
  m        text := tg_argv[0];
  col      text := tg_argv[1];
  new_st   text := to_jsonb(new) ->> col;
  old_st   text;
begin
  if not exists (select 1 from app.machine_states s where s.machine = m and s.state = new_st) then
    raise exception 'INVALID_STATE: %.% = %', tg_table_name, col, new_st using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    old_st := to_jsonb(old) ->> col;
    if new_st is distinct from old_st and not exists (
      select 1 from app.state_transitions t
      where t.machine = m and t.from_state = old_st and t.to_state = new_st
    ) then
      raise exception 'INVALID_TRANSITION: % % → %', m, old_st, new_st using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────
-- 업무실·공급자
-- ─────────────────────────────────────────────

create table public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id),
  name          text not null check (length(trim(name)) between 1 and 200),
  timezone      text not null default 'Asia/Seoul',
  currency      text not null default 'KRW' check (currency = 'KRW'),
  revision      integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- P1: 본인 1명, 업무실 1개
  unique (owner_user_id)
);

-- 공급자(우리 회사) 정보. 바꿀 때마다 새 버전. 견적은 당시 버전을 스냅샷으로 복사한다.
create table public.supplier_profiles (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  version         integer not null check (version > 0),
  legal_name      text not null,
  representative  text,
  business_number text,
  phone           text,
  email           text,
  address         text,
  extra           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (workspace_id, version),
  unique (workspace_id, id)
);

-- ─────────────────────────────────────────────
-- 고객·프로필·프로젝트
-- ─────────────────────────────────────────────

create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  name         text not null check (length(trim(name)) between 1 and 200),
  industry     text,
  description  text,
  archived_at  timestamptz,
  revision     integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, id)
);

-- 회사 프로필 버전: 추가만 가능. 고객 정보를 고쳐도 과거 결과는 당시 버전을 가리킨다(R06).
create table public.company_profile_versions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id    uuid not null,
  version      integer not null check (version > 0),
  products     text,
  audience     text,
  strengths    text[] not null default '{}',
  brand_rules  text,
  channel_urls text[] not null default '{}',
  source_refs  jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id),
  unique (client_id, version),
  unique (client_id, id)
);

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  client_id    uuid,
  kind         text not null check (kind in ('client', 'internal_brand', 'personal')),
  title        text not null check (length(trim(title)) between 1 and 200),
  budget_won   bigint check (budget_won >= 0),
  due_at       date,
  status       text not null default 'received',
  revision     integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- client 유형은 고객 필수, 자체 프로젝트는 고객 없음 (R07)
  check ((kind = 'client') = (client_id is not null)),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id),
  unique (workspace_id, id),
  unique (id, client_id)
);

-- 프로젝트가 사용할 프로필 버전 지정 이력. 다른 고객의 프로필 버전은 연결할 수 없다 (C03).
create table public.project_profiles (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null,
  project_id                 uuid not null,
  client_id                  uuid not null,
  company_profile_version_id uuid not null,
  created_at                 timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, client_id) references public.projects (id, client_id),
  foreign key (client_id, company_profile_version_id) references public.company_profile_versions (client_id, id)
);

-- 자료. 파일 보관 상태와 본문 추출 상태, 내용 검토 상태를 따로 둔다 (T04·T05).
create table public.source_assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id),
  client_id         uuid,
  project_id        uuid,
  kind              text not null check (kind in ('file', 'url', 'text')),
  file_name         text,
  object_key        text,
  url               text check (url is null or url ~ '^https?://'),
  text_content      text,
  mime              text,
  bytes             bigint check (bytes is null or bytes >= 0),
  checksum_sha256   text,
  upload_status     text not null default 'pending' check (upload_status in ('pending', 'stored', 'failed')),
  extraction_status text not null default 'uploaded',
  review_status     text not null default 'unverified' check (review_status in ('unverified', 'verified', 'approved')),
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (client_id is not null or project_id is not null),
  check (
    (kind = 'file' and object_key is not null and file_name is not null) or
    (kind = 'url'  and url is not null) or
    (kind = 'text' and text_content is not null)
  ),
  foreign key (workspace_id, client_id)  references public.clients (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  -- 고객과 프로젝트를 둘 다 지정하면 같은 고객이어야 한다
  foreign key (project_id, client_id)    references public.projects (id, client_id)
);

-- ─────────────────────────────────────────────
-- 템플릿·작업·실행 기록
-- ─────────────────────────────────────────────

-- 시스템 템플릿. 바꿀 때는 새 버전 행을 추가한다 (C10).
create table public.templates (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('logo_brief', 'quote')),
  version       integer not null check (version > 0),
  key           text not null unique,
  input_schema  jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  body          text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (type, version),
  unique (id, type)
);

create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  project_id      uuid not null,
  type            text not null check (type in ('logo_brief', 'quote')),
  template_id     uuid not null,
  status          text not null default 'draft',
  role_key        text,
  due_at          date,
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  revision        integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  -- 템플릿 유형이 작업 유형과 같아야 한다
  foreign key (template_id, type) references public.templates (id, type),
  -- 중복 클릭·재전송 방지 (T15)
  unique (project_id, idempotency_key),
  unique (workspace_id, id),
  unique (project_id, id)
);

-- 실행에 사용한 입력의 불변 사본 (R06)
create table public.task_input_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  task_id             uuid not null,
  profile_snapshot    jsonb not null,
  extra_inputs        jsonb not null default '{}'::jsonb,
  source_version_refs jsonb not null default '[]'::jsonb,
  input_hash          text not null,
  created_at          timestamptz not null default now(),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id)
);

-- 생성·출력 실행 기록과 중복 방지 키 (C01)
create table public.generation_runs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  task_id         uuid not null,
  action          text not null check (action in ('generate', 'export')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  input_hash      text not null,
  status          text not null default 'reserved'
                  check (status in ('reserved', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt         integer not null default 1 check (attempt > 0),
  mode            text check (mode in ('template', 'ai')),
  provider        text,
  model_id        text,
  error_code      text,
  started_at      timestamptz,
  finished_at     timestamptz,
  revision        integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id),
  unique (task_id, action, idempotency_key)
);

-- ─────────────────────────────────────────────
-- 결과물·버전·승인
-- ─────────────────────────────────────────────

-- 결과물. 현재 초안과 승인본을 별도 포인터로 가리킨다 (C02).
create table public.artifacts (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  project_id               uuid not null,
  task_id                  uuid not null,
  type                     text not null check (type in ('logo_brief', 'quote')),
  current_draft_version_id uuid,
  approved_version_id      uuid,
  revision                 integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, task_id) references public.tasks (project_id, id),
  unique (workspace_id, id),
  unique (id, task_id)
);

-- 결과 버전: 추가만 가능. 상태는 승인 이력과 포인터로만 표현한다 (C02·C04).
create table public.artifact_versions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  artifact_id       uuid not null,
  version           integer not null check (version > 0),
  content           jsonb not null,
  input_snapshot_id uuid references public.task_input_snapshots (id),
  generator         text not null check (generator in ('template', 'ai', 'manual')),
  template_id       uuid references public.templates (id),
  model_id          text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  foreign key (workspace_id, artifact_id) references public.artifacts (workspace_id, id),
  unique (artifact_id, version),
  unique (artifact_id, id),
  unique (workspace_id, id)
);

-- 포인터는 같은 결과물의 버전만 가리킬 수 있다
alter table public.artifacts
  add foreign key (id, current_draft_version_id) references public.artifact_versions (artifact_id, id),
  add foreign key (id, approved_version_id)      references public.artifact_versions (artifact_id, id);

create table public.approvals (
  id                  uuid primary key default gen_random_uuid(),
  -- 기록 순서. 같은 시각에 두 결정이 들어와도 순서가 흔들리지 않게 시각 대신 이 값으로 정렬한다
  seq                 bigint generated always as identity unique,
  workspace_id        uuid not null,
  artifact_id         uuid not null,
  artifact_version_id uuid not null,
  actor_id            uuid not null references auth.users (id),
  decision            text not null check (decision in ('approved', 'changes_requested', 'rejected')),
  comment             text,
  created_at          timestamptz not null default clock_timestamp(),
  foreign key (workspace_id, artifact_id) references public.artifacts (workspace_id, id),
  foreign key (artifact_id, artifact_version_id) references public.artifact_versions (artifact_id, id)
);

-- 승인본 포인터는 해당 버전의 마지막 결정이 'approved'일 때만 지정할 수 있다 (T14·R08)
create or replace function app.require_approval() returns trigger
language plpgsql as $$
declare
  last_decision text;
begin
  if new.approved_version_id is not null
     and new.approved_version_id is distinct from old.approved_version_id then
    select a.decision into last_decision
      from public.approvals a
     where a.artifact_version_id = new.approved_version_id
     order by a.seq desc
     limit 1;
    if last_decision is distinct from 'approved' then
      raise exception 'APPROVAL_REQUIRED: 승인 기록이 없는 버전은 승인본으로 지정할 수 없습니다'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────
-- 견적
-- ─────────────────────────────────────────────

create table public.quotes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id      uuid not null,
  artifact_id  uuid not null unique,
  -- 확정 시점에 발번. 초안에는 번호가 없다 (C08)
  quote_number text,
  created_at   timestamptz not null default now(),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id),
  foreign key (artifact_id, task_id) references public.artifacts (id, task_id),
  unique (workspace_id, quote_number),
  unique (id, artifact_id)
);

create table public.quote_number_sequences (
  workspace_id uuid not null references public.workspaces (id),
  year         integer not null check (year between 2000 and 9999),
  last_number  integer not null check (last_number > 0),
  primary key (workspace_id, year)
);

-- 견적 버전: 금액·발행 정보 고정 (R04·R06)
create table public.quote_versions (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  quote_id            uuid not null,
  artifact_id         uuid not null,
  artifact_version_id uuid not null unique,
  supplier_profile_id uuid,
  supplier_snapshot   jsonb not null,
  customer_snapshot   jsonb not null,
  tax_mode            text not null check (tax_mode in ('EXCLUSIVE', 'INCLUSIVE', 'NO_TAX')),
  tax_rate_bp         integer not null check (tax_rate_bp between 0 and 10000),
  subtotal_won        bigint not null check (subtotal_won >= 0),
  tax_won             bigint not null check (tax_won >= 0),
  total_won           bigint not null check (total_won >= 0),
  issue_date          date,
  valid_until         date,
  payment_terms       text,
  notes               text,
  created_at          timestamptz not null default now(),
  check (total_won = subtotal_won + tax_won),
  check (tax_mode <> 'NO_TAX' or (tax_won = 0 and tax_rate_bp = 0)),
  check (valid_until is null or issue_date is null or valid_until >= issue_date),
  foreign key (quote_id, artifact_id) references public.quotes (id, artifact_id),
  foreign key (artifact_id, artifact_version_id) references public.artifact_versions (artifact_id, id),
  foreign key (workspace_id, supplier_profile_id) references public.supplier_profiles (workspace_id, id),
  unique (workspace_id, id)
);

create table public.quote_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  quote_version_id    uuid not null,
  position            integer not null check (position >= 0),
  name                text not null,
  description         text,
  quantity_hundredths bigint not null check (quantity_hundredths > 0),
  -- null(미입력)과 0(무료 확인)을 구분한다
  unit_price_won      bigint check (unit_price_won >= 0),
  line_amount_won     bigint check (line_amount_won >= 0),
  foreign key (workspace_id, quote_version_id) references public.quote_versions (workspace_id, id),
  unique (quote_version_id, position)
);

-- 견적 번호 발번: 이미 번호가 있으면 그대로 돌려준다. 연도는 작성일 기준(없으면 업무실 시간대의 오늘).
create or replace function public.assign_quote_number(p_quote_id uuid, p_issue_date date default null)
returns text
language plpgsql as $$
declare
  ws  uuid;
  tz  text;
  num text;
  yr  integer;
  n   integer;
begin
  select q.workspace_id, q.quote_number, w.timezone
    into ws, num, tz
    from public.quotes q join public.workspaces w on w.id = q.workspace_id
   where q.id = p_quote_id
     for update of q;
  if not found then
    raise exception 'NOT_FOUND: 견적을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if num is not null then
    return num;
  end if;
  yr := extract(year from coalesce(p_issue_date, (now() at time zone tz)::date))::integer;
  insert into public.quote_number_sequences as s (workspace_id, year, last_number)
       values (ws, yr, 1)
  on conflict (workspace_id, year) do update set last_number = s.last_number + 1
  returning s.last_number into n;
  num := format('Q-%s-%s', yr, lpad(n::text, 4, '0'));
  update public.quotes set quote_number = num where id = p_quote_id;
  return num;
end $$;

-- 견적 번호는 한 번 정해지면 바꿀 수 없다
create or replace function app.quote_number_once() returns trigger
language plpgsql as $$
begin
  if old.quote_number is not null and new.quote_number is distinct from old.quote_number then
    raise exception 'FROZEN_COLUMN: quotes.quote_number 는 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────
-- 출력·전달·감사
-- ─────────────────────────────────────────────

create table public.exports (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  artifact_version_id uuid not null,
  format              text not null check (format in ('pdf')),
  idempotency_key     text not null check (length(idempotency_key) between 8 and 100),
  status              text not null default 'pending',
  object_key          text,
  mime                text,
  checksum_sha256     text,
  error_code          text,
  revision            integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (status <> 'ready' or (object_key is not null and checksum_sha256 is not null)),
  foreign key (workspace_id, artifact_version_id) references public.artifact_versions (workspace_id, id),
  unique (artifact_version_id, idempotency_key),
  unique (workspace_id, id)
);

-- P1 전달은 수동 기록만. 외부 발송이 아니다 (R08)
create table public.delivery_records (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  project_id          uuid not null,
  artifact_version_id uuid not null,
  export_id           uuid,
  delivered_at        timestamptz not null,
  method              text not null check (method in ('email_manual', 'messenger_manual', 'download', 'in_person', 'other')),
  note                text,
  created_at          timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (workspace_id, artifact_version_id) references public.artifact_versions (workspace_id, id),
  foreign key (workspace_id, export_id) references public.exports (workspace_id, id)
);

create table public.audit_events (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity unique,
  workspace_id uuid not null references public.workspaces (id),
  entity_type  text not null,
  entity_id    uuid not null,
  actor_id     uuid references auth.users (id),
  action       text not null,
  revision     integer,
  details      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default clock_timestamp()
);

-- ─────────────────────────────────────────────
-- 트리거 연결
-- ─────────────────────────────────────────────

-- 추가 전용 (C04)
do $$
declare t text;
begin
  foreach t in array array[
    'supplier_profiles', 'company_profile_versions', 'project_profiles', 'templates',
    'task_input_snapshots', 'artifact_versions', 'approvals',
    'quote_versions', 'quote_items', 'delivery_records', 'audit_events'
  ] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function app.reject_mutation()',
      t || '_immutable', t);
  end loop;
end $$;

-- 수정 가능 테이블: 고정 컬럼 + revision
create trigger workspaces_guard       before update on public.workspaces       for each row execute function app.guard_update('id', 'owner_user_id', 'created_at');
create trigger clients_guard          before update on public.clients          for each row execute function app.guard_update('id', 'workspace_id', 'created_at');
create trigger projects_guard         before update on public.projects         for each row execute function app.guard_update('id', 'workspace_id', 'client_id', 'kind', 'created_at');
create trigger source_assets_guard    before update on public.source_assets    for each row execute function app.guard_update('id', 'workspace_id', 'client_id', 'project_id', 'kind', 'created_at');
create trigger tasks_guard            before update on public.tasks            for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'type', 'template_id', 'idempotency_key', 'created_at');
create trigger generation_runs_guard  before update on public.generation_runs  for each row execute function app.guard_update('id', 'workspace_id', 'task_id', 'action', 'idempotency_key', 'input_hash', 'created_at');
create trigger artifacts_guard        before update on public.artifacts        for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'task_id', 'type', 'created_at');
create trigger exports_guard          before update on public.exports          for each row execute function app.guard_update('id', 'workspace_id', 'artifact_version_id', 'format', 'idempotency_key', 'created_at');
create trigger quotes_guard           before update on public.quotes           for each row execute function app.guard_update('id', 'workspace_id', 'task_id', 'artifact_id', 'created_at');
create trigger quotes_number_once     before update on public.quotes           for each row execute function app.quote_number_once();
create trigger artifacts_require_approval before update on public.artifacts    for each row execute function app.require_approval();

-- 상태 전이
create trigger projects_state      before insert or update of status            on public.projects      for each row execute function app.enforce_state('project', 'status');
create trigger tasks_state         before insert or update of status            on public.tasks         for each row execute function app.enforce_state('task', 'status');
create trigger source_assets_state before insert or update of extraction_status on public.source_assets for each row execute function app.enforce_state('extraction', 'extraction_status');
create trigger exports_state       before insert or update of status            on public.exports       for each row execute function app.enforce_state('export', 'status');

-- 조회용 인덱스 (외래키 열)
create index on public.clients (workspace_id);
create index on public.projects (workspace_id, status);
create index on public.projects (client_id);
create index on public.source_assets (project_id);
create index on public.source_assets (client_id);
create index on public.tasks (project_id, status);
create index on public.artifacts (project_id);
create index on public.artifact_versions (artifact_id);
create index on public.approvals (artifact_version_id, seq);
create index on public.quote_items (quote_version_id);
create index on public.audit_events (workspace_id, occurred_at);
