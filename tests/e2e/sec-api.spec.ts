import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { adminClient, ownerSupabase, unique } from "./helpers";

/**
 * SEC-E2E-01: 실제 Supabase auth(로그인 세션 JWT)와 PostgREST 를 거쳐 SEC-FIX-01 의 권한 경계를 확인한다.
 * - 본인: 직접 쓰기 우회는 거절, RPC(decide_version·record_delivery)는 성공
 * - 다른 업무실 사용자: 본인 결과물에 RPC → P0002, 조회 0건
 * - 비로그인(anon): RPC·표 접근 거절
 * 로컬 시험 DB 전용(ownerSupabase 가 로컬 주소가 아니면 멈춘다). 다른 사용자 계정은 이 시험이 로컬 관리자 키로 만든다.
 * 결과(HTTP 상태·SQLSTATE)는 [SEC-API] 줄로 출력해 보고서 증거로 쓴다.
 */

test.describe.configure({ mode: "serial" });

/** 다른 업무실 사용자(로컬 시험 DB 전용 값) */
const OTHER_EMAIL = "secb@marketing-office.test";
const OTHER_PASSWORD = "Secb-test-1234";

let owner: SupabaseClient;
let other: SupabaseClient;
let anon: SupabaseClient;
let ownerId = "";
let otherId = "";
let workspaceId = "";
let projectId = "";
let artifactId = "";
let versionId = "";

type Res = { error: { code?: string; message: string } | null; status: number };
function log(name: string, r: Res) {
  console.log(`[SEC-API] ${name} | HTTP ${r.status} | ${r.error ? `${r.error.code} ${r.error.message.slice(0, 90)}` : "OK"}`);
}

test("준비: 본인 업무실·작업·초안(실제 로그인 세션), 다른 업무실 사용자, 비로그인 클라이언트", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  owner = await ownerSupabase();
  ownerId = (await owner.auth.getUser()).data.user!.id;
  const ws = await owner.rpc("setup_workspace", { p_name: "나다움 업무실", p_legal_name: "나다움 마케팅" });
  expect(ws.error).toBeNull();
  workspaceId = ws.data as string;

  const client = await owner.from("clients").insert({ workspace_id: workspaceId, name: unique("가상고객API") }).select("id").single();
  expect(client.error).toBeNull();
  const project = await owner
    .from("projects")
    .insert({ workspace_id: workspaceId, client_id: client.data!.id, kind: "client", title: "API 경계 확인" })
    .select("id")
    .single();
  expect(project.error).toBeNull();
  projectId = project.data!.id;
  const tpl = await owner.from("templates").select("id").eq("key", "logo-template@1").single();
  const task = await owner
    .from("tasks")
    .insert({ workspace_id: workspaceId, project_id: projectId, type: "logo_brief", template_id: tpl.data!.id, idempotency_key: unique("sec-api-task") })
    .select("id")
    .single();
  expect(task.error).toBeNull();
  const gen = await owner
    .rpc("record_generation", {
      p_task_id: task.data!.id,
      p_idempotency_key: unique("sec-api-gen"),
      p_input_hash: "sec-api",
      p_profile_snapshot: {},
      p_extra_inputs: {},
      p_source_refs: [],
      p_content: { brief: "api" },
      p_mode: "template",
    })
    .single<{ artifact_id: string; version_id: string }>();
  expect(gen.error).toBeNull();
  artifactId = gen.data!.artifact_id;
  versionId = gen.data!.version_id;

  // 다른 업무실 사용자: 로컬 관리자 키로 가입 허용 목록에 넣고 계정을 만든 뒤, 일반 로그인으로 쓴다
  const admin = adminClient();
  await admin.from("signup_allowlist").upsert({ email: OTHER_EMAIL });
  const created = await admin.auth.admin.createUser({ email: OTHER_EMAIL, password: OTHER_PASSWORD, email_confirm: true });
  if (created.error && !/already/i.test(created.error.message)) throw created.error;
  other = createClient(url, key, { auth: { persistSession: false } });
  const signIn = await other.auth.signInWithPassword({ email: OTHER_EMAIL, password: OTHER_PASSWORD });
  expect(signIn.error).toBeNull();
  otherId = signIn.data.user!.id;
  const otherWs = await other.rpc("setup_workspace", { p_name: "B 업무실", p_legal_name: "B 상호" });
  expect(otherWs.error).toBeNull();
  expect(otherWs.data).not.toBe(workspaceId);

  anon = createClient(url, key, { auth: { persistSession: false } });
});

test("본인: 승인 기록 직접 insert → 42501(RLS, 정책 없음)", async () => {
  const r = await owner
    .from("approvals")
    .insert({ workspace_id: workspaceId, artifact_id: artifactId, artifact_version_id: versionId, actor_id: ownerId, decision: "approved" });
  log("본인 approvals insert", r);
  expect(r.error?.code).toBe("42501");
  expect(r.error?.message).toMatch(/row-level security policy for table "approvals"/);
});

test("본인: 승인본 포인터 직접 update → 42501(열 권한 없음)", async () => {
  const r = await owner.from("artifacts").update({ approved_version_id: versionId }).eq("id", artifactId);
  log("본인 artifacts.approved_version_id update", r);
  expect(r.error?.code).toBe("42501");
  expect(r.error?.message).toMatch(/permission denied for table artifacts/);
});

test("본인: 전달 기록 직접 insert → 42501", async () => {
  const r = await owner
    .from("delivery_records")
    .insert({ workspace_id: workspaceId, project_id: projectId, artifact_version_id: versionId, delivered_at: new Date().toISOString(), method: "other" });
  log("본인 delivery_records insert", r);
  expect(r.error?.code).toBe("42501");
});

test("본인: 감사 기록 actor 위조 → 42501 ACTOR_MISMATCH, 본인 이름은 허용(잔여 위험 관찰)", async () => {
  const forged = await owner.from("audit_events").insert({ workspace_id: workspaceId, entity_type: "artifact", entity_id: artifactId, actor_id: otherId, action: "x" });
  log("본인 audit insert actor=다른 사용자", forged);
  expect(forged.error?.code).toBe("42501");
  expect(forged.error?.message).toMatch(/ACTOR_MISMATCH/);
  const self = await owner.from("audit_events").insert({ workspace_id: workspaceId, entity_type: "artifact", entity_id: artifactId, actor_id: ownerId, action: "x" });
  log("본인 audit insert actor=본인(잔여 위험)", self);
  expect(self.error).toBeNull(); // 아직 허용됨. 보안 통과가 아니라 남은 위험의 관찰이다
});

test("다른 업무실 사용자: 본인 결과물 조회 0건, decide_version·record_delivery → P0002", async () => {
  const sel = await other.from("artifacts").select("id").eq("id", artifactId);
  log("다른 사용자 artifacts select", sel);
  expect(sel.error).toBeNull();
  expect(sel.data).toEqual([]);
  const d = await other.rpc("decide_version", { p_artifact_id: artifactId, p_version_id: versionId, p_decision: "approved" });
  log("다른 사용자 rpc decide_version", d);
  expect(d.error?.code).toBe("P0002");
  const r = await other.rpc("record_delivery", { p_artifact_id: artifactId, p_method: "other", p_delivered_at: new Date().toISOString() });
  log("다른 사용자 rpc record_delivery", r);
  expect(r.error?.code).toBe("P0002");
});

test("비로그인(anon): RPC·표 접근 거절", async () => {
  const d = await anon.rpc("decide_version", { p_artifact_id: artifactId, p_version_id: versionId, p_decision: "approved" });
  log("anon rpc decide_version", d);
  expect(d.error?.code).toBe("42501");
  const r = await anon.rpc("record_delivery", { p_artifact_id: artifactId, p_method: "other", p_delivered_at: new Date().toISOString() });
  log("anon rpc record_delivery", r);
  expect(r.error?.code).toBe("42501");
  const s = await anon.from("approvals").select("id").limit(1);
  log("anon approvals select", s);
  expect(s.error?.code).toBe("42501");
});

test("본인: RPC 정상 경로 — 승인 → 전달 기록, 행위자·프로젝트·버전 일치", async () => {
  const d = await owner.rpc("decide_version", { p_artifact_id: artifactId, p_version_id: versionId, p_decision: "approved", p_comment: "API 승인" });
  log("본인 rpc decide_version", d);
  expect(d.error).toBeNull();
  const r = await owner.rpc("record_delivery", { p_artifact_id: artifactId, p_method: "download", p_delivered_at: new Date().toISOString(), p_note: "API 전달" });
  log("본인 rpc record_delivery", r);
  expect(r.error).toBeNull();

  const art = await owner.from("artifacts").select("approved_version_id").eq("id", artifactId).single();
  expect(art.data!.approved_version_id).toBe(versionId);
  const ap = await owner.from("approvals").select("actor_id, decision").eq("artifact_id", artifactId);
  expect(ap.data).toEqual([{ actor_id: ownerId, decision: "approved" }]);
  const dr = await owner.from("delivery_records").select("project_id, artifact_version_id, method, note").eq("id", r.data as string).single();
  expect(dr.data).toEqual({ project_id: projectId, artifact_version_id: versionId, method: "download", note: "API 전달" });
  // 다른 사용자의 실패한 시도는 아무 기록도 남기지 않았다
  const otherApprovals = ap.data!.filter((a) => a.actor_id === otherId);
  expect(otherApprovals).toHaveLength(0);
});
