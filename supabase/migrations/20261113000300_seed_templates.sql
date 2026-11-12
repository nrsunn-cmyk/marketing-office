-- 초기 템플릿 (C10). 바꿀 때는 이 행을 고치지 말고 version을 올린 새 행을 추가한다.
-- key 는 src/domain 의 템플릿 버전 상수와 같아야 한다 (테스트로 확인).
insert into public.templates (type, version, key, body) values
  ('logo_brief', 1, 'logo-template@1', '입력 조합형 로고 브리프·이미지 프롬프트. 구현: src/domain/logo/brief.ts'),
  ('quote',      1, 'quote-template@1', '견적 계산·문서. 구현: src/domain/quote/calculate.ts');
