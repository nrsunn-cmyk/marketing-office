-- NADAUM-INQUIRY-DELETE-BACKEND-01: 공개 상담 관리자 건별 영구 삭제
-- 근거: 주인님 결정(2026-11-24 09:21 KST) "개인정보는 계속 보관하고, 관리자가 필요시 직접 삭제"
-- 명세: Design/nadaum-ui-20261123/INQUIRY-ADMIN-DELETE-SPEC-01.md 2절
-- 보고서: Plan/Claude-Backend-20261123/NADAUM-INQUIRY-DELETE-BACKEND-01.md
--
-- 원칙
--   1) 20261123010000(표·접수·목록·상태 변경)은 바꾸지 않는다. 함수 하나만 더한다.
--   2) 관리자만(app.assert_admin(), 아니면 FORBIDDEN). 익명·PUBLIC 실행 권한 없음, 로그인 역할에만 EXECUTE.
--      앱은 public 스키마만 RPC 로 부를 수 있어(supabase/config.toml schemas) 기존 관리자 함수처럼 public 에 둔다.
--   3) 감사 기록(public.admin_access_log)에는 참조 번호·삭제 사유(선택, 200자 이하)·action 만 남긴다.
--      업체명·담당자·연락처·요청 내용 등 개인정보는 남기지 않는다. 감사 기록은 지울 수 없다(기존 트리거).
--   4) 되돌릴 수 없다(영구 삭제). 같은 건을 두 번 지우면 두 번째는 NOT_FOUND.

create or replace function public.admin_delete_public_inquiry(p_inquiry_id uuid, p_reason text default null)
returns table (id uuid, ref_code text)
language plpgsql security definer set search_path = '' as $$
declare
  me       uuid := app.assert_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref    text;
begin
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'VALIDATION: 삭제 사유는 200자 이하로 입력해 주세요' using errcode = '22023';
  end if;
  if p_inquiry_id is null then
    raise exception 'NOT_FOUND: 상담 접수를 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  -- 지우면서 참조 번호만 받아 둔다(다른 칸은 읽지 않는다). 동시에 두 관리자가 지우면 한쪽만 성공한다.
  delete from public.public_inquiries q where q.id = p_inquiry_id returning q.ref_code into v_ref;
  if not found then
    raise exception 'NOT_FOUND: 상담 접수를 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  perform app.admin_log(me, 'admin_delete_public_inquiry',
    jsonb_build_object('action', 'public_inquiry_delete', 'ref_code', v_ref, 'reason', v_reason), 1);
  return query select p_inquiry_id, v_ref;
end;
$$;
revoke execute on function public.admin_delete_public_inquiry(uuid, text) from public, anon;
grant execute on function public.admin_delete_public_inquiry(uuid, text) to authenticated;
