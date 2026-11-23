-- 운영 차단 마이그레이션을 유지하고, 서버 서명이 확인된 호출만 다시 허용한다.
insert into app.server_secrets (name, value)
values ('p4_channel_signing', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'))
on conflict (name) do nothing;

create table app.p4_channel_proofs (
  nonce uuid primary key,
  expires_at timestamptz not null
);
create index p4_channel_proofs_expiry_idx on app.p4_channel_proofs (expires_at);
revoke all on app.p4_channel_proofs from public, anon, authenticated;

create function public.p4_server_channel_call(
  p_action text, p_payload text, p_at bigint, p_nonce uuid, p_signature text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  now_at timestamptz := clock_timestamp();
  now_ms bigint := floor(extract(epoch from now_at) * 1000);
  secret text;
  v jsonb;
begin
  if uid is null or p_action is null or p_nonce is null or p_payload is null
     or octet_length(p_payload) > 8192 or p_at is null
     or p_at < now_ms - 60000 or p_at > now_ms + 5000
     or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' then
    raise exception 'BAD_SIGNATURE: 서버 연동 서명이 유효하지 않습니다' using errcode = '42501';
  end if;
  select value into secret from app.server_secrets where name = 'p4_channel_signing';
  if secret is null or p_signature <> app.hmac_sha256(
    convert_to(secret, 'UTF8'),
    convert_to(concat_ws('|', 'p4', p_action, uid::text, p_at::text, p_nonce::text, p_payload), 'UTF8')
  ) then
    raise exception 'BAD_SIGNATURE: 서버 연동 서명이 유효하지 않습니다' using errcode = '42501';
  end if;

  delete from app.p4_channel_proofs where expires_at < now_at;
  insert into app.p4_channel_proofs values (p_nonce, now_at + interval '70 seconds') on conflict do nothing;
  if not found then
    raise exception 'BAD_SIGNATURE: 이미 사용된 서버 연동 서명입니다' using errcode = '42501';
  end if;

  v := p_payload::jsonb;
  case p_action
    when 'prepare' then
      return public.dispatch_external_execution_prepare((v->>'jobId')::uuid, (v->>'revision')::int);
    when 'finish' then
      return public.finish_external_execution(
        (v->>'jobId')::uuid, (v->>'revision')::int, (v->>'success')::boolean, v->>'externalUrl', v->>'errorCode'
      );
    when 'metrics' then
      return public.get_channel_metrics_credentials(v->>'channel');
    when 'recordMetric' then
      return to_jsonb(public.sync_channel_result(
        (v->>'projectId')::uuid, (v->>'executionJobId')::uuid, v->>'metricName',
        (v->>'value')::numeric, v->>'unit', (v->>'numerator')::numeric, (v->>'denominator')::numeric,
        v->>'sourceNote', (v->>'periodStart')::date, (v->>'periodEnd')::date
      ));
    else
      raise exception 'VALIDATION: 지원하지 않는 서버 연동 작업입니다' using errcode = '22023';
  end case;
end;
$$;

revoke execute on function public.p4_server_channel_call(text, text, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.p4_server_channel_call(text, text, bigint, uuid, text) to authenticated;
revoke execute on function public.sync_channel_result(uuid, uuid, text, numeric, text, numeric, numeric, text, date, date)
  from public, anon, authenticated;
