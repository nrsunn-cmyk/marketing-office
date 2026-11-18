-- SEC-AUDIT-FIX-02 R-A·R-B: 감사 기록 최소 권한, 결과물 유형 = 작업 유형 강제 (QA-SEC-AUDIT-02 5절)
--
-- R-A 감사 기록 UPDATE·DELETE·TRUNCATE 권한 회수
--   Supabase 기본값으로 authenticated 에 모든 표 권한이 있다. UPDATE·DELETE 는 RLS 때문에 0행이지만,
--   TRUNCATE 는 RLS 와 행 트리거(추가 전용 표의 수정 불가 트리거 포함)를 건너뛰어 표 전체를 비운다.
--   지금 API(PostgREST)에는 TRUNCATE 경로가 없어 앱 사용자가 보낼 수는 없다. 방어를 한 겹 더 두는 보강이다.
--   - audit_events: UPDATE·DELETE·TRUNCATE 회수(남는 것은 SELECT 뿐. INSERT 는 20261117003000 에서 회수)
--   - public 의 모든 표: TRUNCATE 회수. 같은 이유(행 트리거·RLS 우회)이고, 앱·RPC·시험 어디에서도
--     로그인 역할로 TRUNCATE 하지 않는다(복원 연습 스크립트는 postgres 로 접속).
--   다른 추가 전용 표의 UPDATE·DELETE 는 수정 불가 트리거(reject_mutation)가 막으므로 이번에 바꾸지 않는다.
--
-- R-B 결과물 유형 = 작업 유형
--   artifacts 에 "유형이 작업 유형과 같다"는 제약이 없어, 전략 작업에 logo_brief 결과물을 직접 넣으면
--   전략 거절 검사(결과물 유형 기준)를 모두 통과해 save_manual_version 으로 전략 작업 상태를 바꿀 수 있었다.
--   → 결과물을 넣기 전에 작업 유형과 같은지 확인한다. 두 표 모두 type·task_id 가 고정 열(guard_update)이라
--     넣을 때 한 번만 확인하면 된다.
--   - 호출자 권한(invoker)으로 둔다. 정의자로 하면 남의 작업 UUID 로 오류 차이를 보고 유형을 알아낼 수 있다.
--     호출자 권한에서는 남의 작업이 보이지 않아 그대로 통과하고, 뒤의 RLS·FK 가 막는다.
--     정의자 RPC 안에서는 함수 소유자 권한이라 작업이 보이므로 정상 확인된다.
--   - 기존 데이터는 바꾸지 않는다(새로 넣는 행만 확인). 어긋난 기존 행 조회는 보고서에 따로 둔다.
--
-- 기존 마이그레이션 파일은 고치지 않았다.

-- ─────────────────────────────────────────────
-- R-A
-- ─────────────────────────────────────────────
revoke update, delete, truncate on public.audit_events from authenticated, anon;

do $$
declare t text;
begin
  for t in select c.relname from pg_catalog.pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- R-B
-- ─────────────────────────────────────────────
create or replace function app.enforce_artifact_task_type() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  tt text;
begin
  select k.type into tt from public.tasks k where k.id = new.task_id;
  -- 보이지 않는 작업(남의 것·없는 것)은 여기서 판단하지 않는다. 뒤의 FK·RLS 가 거절한다.
  if found and tt is distinct from new.type then
    raise exception 'TYPE_MISMATCH: 결과물 유형은 작업 유형과 같아야 합니다' using errcode = '23514';
  end if;
  return new;
end $$;
-- 트리거 함수는 실행 시 EXECUTE 권한을 보지 않는다. 직접 부르지 못하게 기존 트리거 함수와 같이 회수한다
revoke execute on function app.enforce_artifact_task_type() from public, anon, authenticated;

create trigger artifacts_type_matches_task before insert on public.artifacts
  for each row execute function app.enforce_artifact_task_type();
