-- 연동 키와 외부 실행 결과 기록은 브라우저가 사용하는 DB 역할에서 차단한다.
-- 검증된 서버 전용 연동 경로가 마련되기 전까지 외부 실행과 성과 가져오기는 보류한다.
revoke execute on function
  public.dispatch_external_execution_prepare(uuid, int),
  public.finish_external_execution(uuid, int, boolean, text, text),
  public.get_channel_metrics_credentials(text)
from public, anon, authenticated;
