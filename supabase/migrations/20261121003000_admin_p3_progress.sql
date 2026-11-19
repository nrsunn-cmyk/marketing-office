-- ADMIN-P3-01 관리자: 업무실·프로젝트별 P3 제작 진행 현황(읽기 전용). AGY 시안 C:/nadaum/Design/admin/p3-progress.html·P3-ADMIN-HANDOFF.md.
-- 범위: 관리자 전용 정의자 RPC 하나(admin_p3_progress). 개수·상태·시각만 돌려준다 — 브리프 제목·본문, 홈페이지 문구, 프로젝트 이름 등
--   사용자 글은 0바이트(설계 1절 감사 본문 0). 업무실 이름·주인 이메일은 기존 관리자 화면과 같은 범위.
--   구현된 단계(P3-a 제작 브리프, P3-b 홈페이지 문서)만 실제 개수, 나머지 단계는 돌려주지 않는다(화면이 '준비 중' — 근거 없는 진행률 금지).
--   승인 대기(P3-f 검수)는 아직 없는 기능이라 null(화면 '준비 중').
-- 바뀌지 않는 것: 표·기존 RPC·데이터. 열람할 때마다 admin_access_log 1행(기존 관리자 RPC 와 같다).

create or replace function public.admin_p3_progress(p_limit integer default 200)
returns table (
  workspace_id uuid, workspace_name text, owner_email text, project_id uuid,
  briefs_drafting integer, briefs_ready integer, briefs_archived integer,
  web_docs_drafting integer, web_docs_reviewed integer, web_docs_archived integer, web_versions integer,
  stale_briefs integer, stale_web_docs integer,
  brief_limit_reached boolean, web_version_limit_reached integer,
  pending_approvals integer,
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
  with b as (
    -- 제작 브리프가 하나라도 있는 프로젝트만(P3 를 시작한 곳)
    select pb.workspace_id, pb.project_id,
           count(*) filter (where pb.archived_at is null and pb.status = 'drafting')::int as drafting,
           count(*) filter (where pb.archived_at is null and pb.status = 'ready')::int as ready,
           count(*) filter (where pb.archived_at is not null)::int as archived,
           count(*) filter (where pb.archived_at is null and pb.strategy_version_id is distinct from a.approved_version_id)::int as stale,
           max(pb.updated_at) as last_at
      from public.production_briefs pb
      join public.artifacts a on a.id = pb.strategy_artifact_id
     group by pb.workspace_id, pb.project_id
  ), d as (
    select wd.project_id,
           count(*) filter (where wd.archived_at is null and wd.status = 'drafting')::int as drafting,
           count(*) filter (where wd.archived_at is null and wd.status = 'reviewed')::int as reviewed,
           count(*) filter (where wd.archived_at is not null)::int as archived,
           coalesce(sum(wd.current_version_no), 0)::int as versions,
           count(*) filter (where wd.archived_at is null and wd.source_brief_revision <> pb.revision)::int as stale,
           count(*) filter (where wd.archived_at is null and wd.current_version_no >= 100)::int as full_docs,
           max(wd.updated_at) as last_at
      from public.web_copy_docs wd
      join public.production_briefs pb on pb.id = wd.production_brief_id
     group by wd.project_id
  )
  select w.id, w.name, u.email::text, b.project_id,
         b.drafting, b.ready, b.archived,
         coalesce(d.drafting, 0), coalesce(d.reviewed, 0), coalesce(d.archived, 0), coalesce(d.versions, 0),
         b.stale, coalesce(d.stale, 0),
         (b.drafting + b.ready) >= 10,
         coalesce(d.full_docs, 0),
         null::integer,
         greatest(b.last_at, d.last_at)
    from b
    join public.workspaces w on w.id = b.workspace_id
    left join auth.users u on u.id = w.owner_user_id
    left join d on d.project_id = b.project_id
   order by greatest(b.last_at, d.last_at) desc nulls last, w.id, b.project_id
   limit p_limit;
  get diagnostics n = row_count;
  perform app.admin_log(me, 'admin_p3_progress', jsonb_build_object('limit', p_limit), n);
end $$;
revoke execute on function public.admin_p3_progress(integer) from public, anon;
grant execute on function public.admin_p3_progress(integer) to authenticated;
