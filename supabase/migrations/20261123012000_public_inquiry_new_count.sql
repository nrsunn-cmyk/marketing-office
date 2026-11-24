-- ADMIN-INQUIRY-COUNT-LITE-01 (설계 Plan/Claude-Backend-20261124/ADMIN-INQUIRY-COUNT-LITE-DESIGN-01.md A안)
-- 관리자 머리글 「공개 상담」 배지용: 신규(new) 상담 건수 하나만 돌려준다.
-- 개인정보·id 없음, 화면 입구용이라 감사 기록(admin_access_log)을 남기지 않는다(admin_whoami 와 같은 관례).
-- 기존 admin_public_inquiry_counts()(상태 4종, 기록 남김)는 그대로 둔다 — /admin/inquiries 상태 탭이 계속 쓴다.
-- 번호는 출시 순서 규칙에 따라 배포 직전에 다시 정할 수 있다(내용 불변).

create or replace function public.admin_public_inquiry_new_count()
returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_admin();   -- 관리자가 아니면 FORBIDDEN(42501)
  return (select count(*)::int from public.public_inquiries q where q.status = 'new');
end;
$$;
revoke execute on function public.admin_public_inquiry_new_count() from public, anon;
grant execute on function public.admin_public_inquiry_new_count() to authenticated;
