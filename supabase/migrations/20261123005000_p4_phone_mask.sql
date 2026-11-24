-- P4-PHONE-MASK-BACKEND-01 (Tester QA-P4-PRIVACY-DELTA-01 F2)
-- app.mask_phone 이 글자 수(하이픈 포함) 8자 이상이면 앞 3 + 뒤 4 를 보여, 짧은 번호는 숫자 대부분이 드러났다
--   (15881234 → 158-****-1234 는 8자리 중 1자리만 가림).
-- 새 규칙: 숫자만 세어 어떤 길이든 숫자를 4개 이상 가린다. 휴대전화 11자리의 익숙한 형식(010-****-5678)은 그대로.
--   숫자 11자리 이상 : 앞 3 + '-****-' + 뒤 4   (010-1234-5678 → 010-****-5678, 가림 = 숫자 수 - 7 ≥ 4)
--   숫자 10자리      : 앞 2 + '-****-' + 뒤 4   (0212345678 → 02-****-5678, 가림 4)
--   숫자 8~9자리     : '****-' + 뒤 4           (15881234 → ****-1234, 가림 4~5)
--   숫자 1~7자리     : '***'                    (숫자 보이지 않음)
--   숫자 없음        : 빈칸이면 '', 글자만 있으면 '***'
-- 반환 형식(text)·이름·인자·실행 권한·list_masked_inquiries 계약은 그대로다. 원문 데이터는 바꾸지 않는다.
create or replace function app.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  with d as (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as n)
  select case
    when p_phone is null or char_length(trim(p_phone)) = 0 then ''
    when char_length(d.n) >= 11 then left(d.n, 3) || '-****-' || right(d.n, 4)
    when char_length(d.n) = 10 then left(d.n, 2) || '-****-' || right(d.n, 4)
    when char_length(d.n) >= 8 then '****-' || right(d.n, 4)
    else '***'
  end
  from d
$$;

revoke execute on function app.mask_phone(text) from public, anon, authenticated;
