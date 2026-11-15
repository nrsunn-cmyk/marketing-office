/**
 * 가입 허용 이메일 등록 + (선택) 계정 바로 만들기. 관리자 키가 필요하므로 이 스크립트에서만 쓴다(C05).
 *
 * 1) 허용만 등록 (운영 기본: 본인이 화면에서 회원가입한다)
 *      node --env-file=.env.production.local scripts/create-owner.mts owner@example.com --allow-only
 * 2) 허용 등록 + 계정 생성(메일 인증 생략). 비밀번호를 주지 않으면 '비밀번호 찾기'로 정한다.
 *      node --env-file=.env.local scripts/create-owner.mts owner@example.com [--password 시험용비밀번호]
 *
 * 허용 이메일은 두 곳에 있어야 한다: 앱 환경 변수 ALLOWED_USER_EMAILS + DB public.signup_allowlist(이 스크립트가 넣음).
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const pwIndex = args.indexOf("--password");
const password = pwIndex >= 0 ? args[pwIndex + 1] : undefined;
// 이메일 = 옵션도 아니고 --password 의 값도 아닌 첫 인자
const email = args
  .filter((a, i) => !a.startsWith("--") && !(pwIndex >= 0 && i === pwIndex + 1))[0]
  ?.trim()
  .toLowerCase();
const allowOnly = args.includes("--allow-only");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const allowed = (process.env.ALLOWED_USER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());

if (!email || !email.includes("@") || (pwIndex >= 0 && !password)) {
  console.error("사용법: node --env-file=<환경 파일> scripts/create-owner.mts <이메일> [--allow-only] [--password <비밀번호>]");
  process.exit(1);
}
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SECRET_KEY 가 필요합니다.");
  process.exit(1);
}
if (!allowed.includes(email)) {
  console.error(`${email} 이 ALLOWED_USER_EMAILS 에 없습니다. 먼저 환경 파일(운영은 Vercel 환경 변수도)에 추가해 주세요.`);
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// DB를 막 초기화·변경한 직후에는 API가 새 표를 아직 모를 수 있다(PGRST205). 잠깐씩 기다리며 몇 번 다시 시도한다.
let listed = await admin.from("signup_allowlist").upsert({ email, note: "create-owner 스크립트" }, { onConflict: "email" });
for (let i = 0; i < 10 && listed.error?.code === "PGRST205"; i += 1) {
  await new Promise((r) => setTimeout(r, 1_000));
  listed = await admin.from("signup_allowlist").upsert({ email, note: "create-owner 스크립트" }, { onConflict: "email" });
}
if (listed.error) {
  console.error("가입 허용 목록에 넣지 못했습니다:", listed.error.message);
  process.exit(1);
}
console.log(`가입 허용 목록에 등록했습니다: ${email}`);
if (allowOnly) process.exit(0);

const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  if (/already been registered|already exists/i.test(error.message)) {
    console.log(`이미 있는 계정입니다: ${email}`);
    process.exit(0);
  }
  console.error("계정을 만들지 못했습니다:", error.message);
  process.exit(1);
}
console.log(`계정을 만들었습니다: ${data.user.email}${password ? " (비밀번호 설정됨)" : " (비밀번호는 '비밀번호 찾기'로 정함)"}`);
