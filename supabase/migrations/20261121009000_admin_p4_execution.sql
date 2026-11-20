-- ADMIN-P4-01 관리자: 업무실·프로젝트별 P4 실행 현황(읽기 전용). AGY 시안 C:/nadaum/Design/admin/p4-execution.html·P4-ADMIN-HANDOFF.md.
-- 범위: 관리자 전용 정의자 RPC 하나(admin_p4_execution). 개수·상태·시각만 돌려준다.
--   실행 건 상태 7종 개수, 막힘 원인 3종 개수(차단 건), 재시도 3회 소진 건수, 티스토리 수동 게시 기록이 연결된 실행 건 수,
--   성과 입력 수(취소 안 된 것), 최근 활동 시각.
--   본문·게시 주소·개인정보 0바이트(인계 1절): 초안 사본(payload)·제목·본문, external_url·게시 기록 주소, 성과 출처·수치·메모,
--   업무실 이름·주인 이메일·프로젝트 이름을 돌려주지 않는다. 업무실·프로젝트는 id 만(화면은 짧은 id 로 보인다).
--   (P3 진행 현황은 업무실 이름·주인 이메일을 보였지만, P4 인계는 '업무실 식별자/별칭'만 허용이라 더 좁게 둔다)
-- 바뀌지 않는 것: 표·기존 RPC·데이터. 열람할 때마다 admin_access_log 1행(기존 관리자 RPC 와 같다). 비관리자는 FORBIDDEN(앱은 404).
-- migration 이름: P4A(20261121007000) 다음. 20261121008000 은 P3-d 영상(claude/p3d-video-backend)이 쓰므로 009000.

create or replace function public.admin_p4_execution(p_limit integer default 200)
returns table (
  workspace_id uuid, project_id uuid,
  jobs_pending_approval integer, jobs_blocked_mismatch integer, jobs_queued integer, jobs_running integer,
  jobs_succeeded integer, jobs_failed integer, jobs_held integer,
  blocked_content_changed integer, blocked_source_archived integer, blocked_not_reviewed integer,
  retry_exhausted integer,
  tistory_published integer,
  results_active integer,
  last_activity_at timestamptz
)
-- 열람 기록(INSERT)을 남기므로 VOLATILE(기본). 기존 관리자 RPC 와 같다
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := app.assert_admin();
  n  integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'VALIDATION: 개수는 1~500 이어야 합니다' using errcode = '22023';
  end if;
  return query
  with j as (
    select x.workspace_id, x.project_id,
           count(*) filter (where x.status = 'pending_approval')::int as pending_approval,
           count(*) filter (where x.status = 'blocked_mismatch')::int as blocked_mismatch,
           count(*) filter (where x.status = 'queued')::int as queued,
           count(*) filter (where x.status = 'running')::int as running,
           count(*) filter (where x.status = 'succeeded')::int as succeeded,
           count(*) filter (where x.status = 'failed')::int as failed,
           count(*) filter (where x.status = 'held')::int as held,
           count(*) filter (where x.status = 'blocked_mismatch' and x.block_reason = 'content_changed')::int as b_content,
           count(*) filter (where x.status = 'blocked_mismatch' and x.block_reason = 'source_archived')::int as b_archived,
           count(*) filter (where x.status = 'blocked_mismatch' and x.block_reason = 'not_reviewed')::int as b_review,
           count(*) filter (where x.attempt_count >= 3)::int as exhausted,
           count(*) filter (where x.publication_id is not null)::int as published,
           max(x.updated_at) as last_at
      from public.execution_jobs x
     group by x.workspace_id, x.project_id
  ), r as (
    select x.workspace_id, x.project_id,
           count(*) filter (where x.status = 'active')::int as active,
           max(x.updated_at) as last_at
      from public.execution_results x
     group by x.workspace_id, x.project_id
  ), k as (
    -- 실행 건이나 성과 입력이 하나라도 있는 프로젝트(P4 를 시작한 곳)
    select j.workspace_id, j.project_id from j
    union
    select r.workspace_id, r.project_id from r
  )
  select k.workspace_id, k.project_id,
         coalesce(j.pending_approval, 0), coalesce(j.blocked_mismatch, 0), coalesce(j.queued, 0), coalesce(j.running, 0),
         coalesce(j.succeeded, 0), coalesce(j.failed, 0), coalesce(j.held, 0),
         coalesce(j.b_content, 0), coalesce(j.b_archived, 0), coalesce(j.b_review, 0),
         coalesce(j.exhausted, 0),
         coalesce(j.published, 0),
         coalesce(r.active, 0),
         greatest(j.last_at, r.last_at)
    from k
    left join j on j.workspace_id = k.workspace_id and j.project_id = k.project_id
    left join r on r.workspace_id = k.workspace_id and r.project_id = k.project_id
   order by greatest(j.last_at, r.last_at) desc nulls last, k.workspace_id, k.project_id
   limit p_limit;
  get diagnostics n = row_count;
  perform app.admin_log(me, 'admin_p4_execution', jsonb_build_object('limit', p_limit), n);
end $$;
revoke execute on function public.admin_p4_execution(integer) from public, anon;
grant execute on function public.admin_p4_execution(integer) to authenticated;
