/**
 * 본인(운영자) 계정 만들기. 공개 가입이 꺼져 있으므로(C09) 관리자 키로 한 번만 만든다.
 * 실행: node --env-file=.env.local scripts/create-owner.mts owner@example.com
 *
 * 주의(C05): SUPABASE_SECRET_KEY(관리자 키)는 이 스크립트에서만 쓴다. 앱 요청 처리 코드에서는 절대 쓰지 않는다.
 */
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const allowed = (process.env.ALLOWED_USER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());

if (!email || !email.includes("@")) {
  console.error("사용법: node --env-file=.env.local scripts/create-owner.mts <이메일>");
  process.exit(1);
}
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SECRET_KEY 가 필요합니다 (.env.local).");
  process.exit(1);
}
if (!allowed.includes(email)) {
  console.error(`${email} 이 ALLOWED_USER_EMAILS 에 없습니다. 먼저 .env.local 에 추가해 주세요.`);
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
if (error) {
  if (/already been registered|already exists/i.test(error.message)) {
    console.log(`이미 있는 계정입니다: ${email}`);
    process.exit(0);
  }
  console.error("계정을 만들지 못했습니다:", error.message);
  process.exit(1);
}
console.log(`계정을 만들었습니다: ${data.user.email}`);
