/**
 * 검수용 예시 데이터 채우기 — 로컬 시험 DB 전용 (Codex 순차 검수 계획 4번·7번, 개발계획 W09)
 *
 * 현황 화면의 숫자 카드·납기 임박·처리할 작업·최근 결과물, 자료실·결과물 목록, 견적 PDF를
 * 실제와 비슷한 데이터로 확인할 수 있게 고객 3곳·프로젝트 7개·작업·결과 버전·확정 견적을 만든다.
 * 앱과 같은 DB 함수(record_generation, decide_version, save_draft_version, finalize_quote)를
 * 본인 계정 권한(RLS)으로 불러서 만든다. 관리자 키를 쓰지 않는다.
 *
 * 실행 (먼저 npm run e2e:reset 으로 시험 계정을 만든다):
 *   node --env-file=.env.local scripts/seed-review-data.mts [이메일] [비밀번호]
 *   기본값은 시험 계정 owner@marketing-office.test / Owner-test-1234
 *
 * 안전장치: Supabase 주소가 127.0.0.1·localhost 가 아니면 아무것도 하지 않고 멈춘다(운영 DB 보호).
 * 같은 예시 고객이 이미 있으면 다시 만들지 않는다(두 번 실행해도 중복 없음).
 */
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { LogoBriefFormInput } from "../src/contracts/index.ts";
import type { Database, Json } from "../src/server/supabase/database.types.ts";
import { SEED_LOGO_INPUTS, seedLogoContent } from "./seed-logo-content.mts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const email = process.argv[2] ?? "owner@marketing-office.test";
const password = process.argv[3] ?? "Owner-test-1234";

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) {
  console.error(`로컬 시험 DB가 아닙니다(${url || "주소 없음"}). 운영 DB 보호를 위해 멈춥니다.`);
  process.exit(1);
}

const sb = createClient<Database>(url, key, { auth: { persistSession: false } });
const login = await sb.auth.signInWithPassword({ email, password });
if (login.error) {
  console.error("로그인 실패:", login.error.message, "— 먼저 npm run e2e:reset 으로 시험 계정을 만들어 주세요.");
  process.exit(1);
}

/** 결과 값이 없는 저장(상태 변경·연결 등): 오류만 확인한다 */
function check(label: string, r: { error: { message: string } | null }): void {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
}

/** 오류가 있거나 값이 비어 있으면 멈춘다 */
function must<R extends { data: unknown; error: { message: string } | null }>(label: string, r: R): NonNullable<R["data"]> {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.data == null) throw new Error(`${label}: 결과가 비어 있습니다`);
  return r.data as NonNullable<R["data"]>;
}
const today = new Date();
const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

// 1) 업무실 (없으면 만든다)
const found = await sb.from("workspaces").select("id, name").maybeSingle();
if (found.error) throw new Error(`업무실 조회: ${found.error.message}`);
let workspace = found.data;
if (!workspace) {
  check("업무실 만들기", await sb.rpc("setup_workspace", { p_name: "나다움 업무실", p_legal_name: "나다움 마케팅" }));
  workspace = must("업무실 조회", await sb.from("workspaces").select("id, name").single());
}
const ws = workspace.id;

const MARK = "가상고객A 카페 온도";
const existing = must("중복 확인", await sb.from("clients").select("id").eq("workspace_id", ws).eq("name", MARK));
if (existing.length > 0) {
  console.log("예시 데이터가 이미 있습니다. 다시 만들려면 npm run e2e:reset 후 실행하세요.");
  process.exit(0);
}

// 2) 고객과 회사 프로필
async function addClient(name: string, industry: string, description: string, profile: Record<string, string>) {
  const c = must(`고객 ${name}`, await sb.from("clients").insert({ workspace_id: ws, name, industry, description }).select("id").single());
  check(
    `프로필 ${name}`,
    await sb.from("company_profile_versions").insert({
      workspace_id: ws,
      client_id: c.id,
      version: 1,
      products: profile.products,
      audience: profile.audience,
      strengths: profile.strengths!.split(",").map((s) => s.trim()), // 표 칸이 목록(text[])이다
      brand_rules: profile.brandRules ?? null,
      channel_urls: [],
    }),
  );
  return c.id as string;
}

const clientA = await addClient(MARK, "카페·디저트", "동네 스페셜티 카페 (검수용 예시)", {
  products: "핸드드립 커피, 계절 디저트",
  audience: "20~30대 직장인, 주말 가족 손님",
  strengths: "직접 로스팅, 조용한 좌석",
  brandRules: "따뜻한 갈색과 아이보리, 손글씨 느낌",
});
const clientB = await addClient("가상고객B 세무회계 바른숫자", "세무·회계", "소규모 세무사무소 (검수용 예시)", {
  products: "기장 대행, 종합소득세 신고",
  audience: "1인 사업자, 프리랜서",
  strengths: "빠른 답변, 투명한 수수료",
});
const clientC = await addClient(
  "가상고객C 친환경 생활용품 제조·온라인 유통 전문 주식회사 지구를생각하는사람들",
  "생활용품 제조",
  "이름이 아주 긴 고객 — 목록·카드 줄바꿈 확인용 (검수용 예시)",
  { products: "친환경 세제, 다회용 용기", audience: "30~40대 가구", strengths: "리필 스테이션 운영" },
);

// 3) 프로젝트 (상태는 앱의 전환 규칙대로 차례로 바꾼다)
async function addProject(title: string, opts: { clientId?: string; kind?: "client" | "internal_brand"; dueOffset?: number | null; budget?: number; path?: string[] }) {
  const kind = opts.kind ?? "client";
  const p = must(
    `프로젝트 ${title}`,
    await sb
      .from("projects")
      .insert({
        workspace_id: ws,
        client_id: kind === "client" ? opts.clientId : null,
        kind,
        title,
        budget_won: opts.budget ?? null,
        due_at: opts.dueOffset == null ? null : day(opts.dueOffset),
      })
      .select("id")
      .single(),
  );
  if (kind === "client" && opts.clientId) {
    const prof = must("프로필", await sb.from("company_profile_versions").select("id").eq("client_id", opts.clientId).single());
    check("프로필 연결", await sb.from("project_profiles").insert({ workspace_id: ws, project_id: p.id, client_id: opts.clientId, company_profile_version_id: prof.id }));
  }
  for (const status of opts.path ?? []) check(`${title} → ${status}`, await sb.from("projects").update({ status }).eq("id", p.id));
  return p.id as string;
}

const pA1 = await addProject("A 로고 리뉴얼", { clientId: clientA, dueOffset: 3, budget: 1_500_000, path: ["active"] });
const pA2 = await addProject("A 가을 메뉴 홍보 준비", { clientId: clientA, dueOffset: 12, path: ["waiting_material"] });
await addProject("A 여름 이벤트 포스터", { clientId: clientA, dueOffset: -20, path: ["active", "review", "delivered", "completed"] });
const pB1 = await addProject("B 신규 상담 랜딩 기획", { clientId: clientB, dueOffset: 1, budget: 800_000 });
const pB2 = await addProject("B 연간 관리 계약 제안", { clientId: clientB, dueOffset: -2, path: ["active", "review"] });
const pC1 = await addProject("C 친환경 세제 신제품 출시 기념 온·오프라인 통합 브랜드 리뉴얼 프로젝트(2026 하반기)", {
  clientId: clientC,
  budget: 12_000_000,
  path: ["waiting_material", "active"],
});
const pIn = await addProject("자체 브랜드 블로그 정비", { kind: "internal_brand", dueOffset: 5, path: ["active"] });

// 4) 작업
const templates = must("템플릿", await sb.from("templates").select("id, type").eq("active", true));
const tpl = (type: string) => templates.find((t) => t.type === type)!.id;
async function addTask(projectId: string, type: "logo_brief" | "quote", path: string[] = []) {
  const t = must(
    `작업 ${type}`,
    await sb.from("tasks").insert({ workspace_id: ws, project_id: projectId, type, template_id: tpl(type), idempotency_key: randomUUID() }).select("id").single(),
  );
  for (const status of path) check(`작업 → ${status}`, await sb.from("tasks").update({ status }).eq("id", t.id));
  return t.id as string;
}

// 로고 브리프 결과 버전 — 앱의 '입력 조합형' 생성과 같은 함수(buildLogoBrief)·같은 내용 모양으로 만든다(SEED-01)
async function logoResult(taskId: string, input: LogoBriefFormInput) {
  const content = seedLogoContent(input);
  const r = must(
    "결과 기록",
    await sb
      .rpc("record_generation", {
        p_task_id: taskId,
        p_idempotency_key: randomUUID(),
        p_input_hash: hash({ taskId, input }),
        p_profile_snapshot: {},
        p_extra_inputs: input as unknown as Json,
        p_source_refs: [],
        p_content: content as unknown as Json,
        p_mode: "template",
      })
      .single(),
  ) as { artifact_id: string; version_id: string };
  return r;
}

const tA1logo = await addTask(pA1, "logo_brief");
await logoResult(tA1logo, SEED_LOGO_INPUTS.a); // → 검토 중(처리할 작업·최근 결과물)

const tB2logo = await addTask(pB2, "logo_brief");
const b2 = await logoResult(tB2logo, SEED_LOGO_INPUTS.b);
check("수정 요청", await sb.rpc("decide_version", { p_artifact_id: b2.artifact_id, p_version_id: b2.version_id, p_decision: "changes_requested", p_comment: "색을 더 차분하게" }));

const tInLogo = await addTask(pIn, "logo_brief");
const inr = await logoResult(tInLogo, SEED_LOGO_INPUTS.internal);
check("승인", await sb.rpc("decide_version", { p_artifact_id: inr.artifact_id, p_version_id: inr.version_id, p_decision: "approved", p_comment: "좋아요" }));

await addTask(pB1, "logo_brief", ["ready"]); // 준비됨
await addTask(pA2, "logo_brief", ["waiting_material"]); // 자료 대기
await addTask(pC1, "logo_brief"); // 작성 전

// 5) 견적: A 로고 리뉴얼은 확정(번호·PDF), C 프로젝트는 초안만
async function quoteDraft(taskId: string, projectTitle: string, customer: string, items: Array<{ name: string; description?: string; price: number }>) {
  const subtotal = items.reduce((s, it) => s + it.price, 0);
  const tax = subtotal / 10; // 10원 단위 금액만 써서 부가세가 정확히 떨어지게 한다
  const content = {
    form: {
      taxMode: "EXCLUSIVE",
      taxRateBasisPoints: 1000,
      issueDate: day(0),
      validUntil: day(30),
      paymentTerms: "계약 시 50%, 납품 후 50%",
      notes: "검수용 예시 견적입니다.",
      items: items.map((it) => ({ name: it.name, description: it.description ?? null, quantityHundredths: 100, unitPriceWon: it.price })),
    },
    totals: { subtotalWon: subtotal, taxWon: tax, totalWon: subtotal + tax, isFinalizable: true },
    customer: { name: customer },
  };
  const snapshot = { project: { title: projectTitle }, customer: { name: customer } };
  const v = must(
    "견적 초안",
    await sb.rpc("save_draft_version", { p_task_id: taskId, p_expected_revision: null as unknown as number, p_input_hash: hash({ snapshot, content }), p_snapshot: snapshot, p_content: content }).single(),
  ) as { artifact_id: string; version_id: string; version: number };
  return { ...v, content, subtotal, tax };
}

const tA1quote = await addTask(pA1, "quote");
const qa = await quoteDraft(tA1quote, "A 로고 리뉴얼", MARK, [
  { name: "로고 기획·시안 3종", description: "방향 3가지, 수정 2회 포함", price: 900_000 },
  { name: "브랜드 가이드 1장", price: 300_000 },
]);
const supplier = must(
  "공급자",
  await sb.from("supplier_profiles").select("*").eq("workspace_id", ws).order("version", { ascending: false }).limit(1).single(),
);
must(
  "견적 확정",
  await sb
    .rpc("finalize_quote", {
      p_artifact_id: qa.artifact_id,
      p_version_id: qa.version_id,
      p_supplier_profile_id: supplier.id,
      p_supplier_snapshot: supplier,
      p_customer_snapshot: qa.content.customer,
      p_tax_mode: "EXCLUSIVE",
      p_tax_rate_bp: 1000,
      p_subtotal_won: qa.subtotal,
      p_tax_won: qa.tax,
      p_total_won: qa.subtotal + qa.tax,
      p_issue_date: qa.content.form.issueDate,
      p_valid_until: qa.content.form.validUntil,
      p_payment_terms: qa.content.form.paymentTerms,
      p_notes: qa.content.form.notes,
      p_items: qa.content.form.items.map((it) => ({
        name: it.name,
        description: it.description,
        quantity_hundredths: it.quantityHundredths,
        unit_price_won: it.unitPriceWon,
        line_amount_won: it.unitPriceWon, // 수량 1.00 이므로 줄 금액 = 단가
      })),
    })
    .single(),
);

const tC1quote = await addTask(pC1, "quote");
await quoteDraft(tC1quote, "C 통합 브랜드 리뉴얼", "가상고객C 친환경 생활용품 제조·온라인 유통 전문 주식회사 지구를생각하는사람들", [
  { name: "통합 브랜드 전략 수립", price: 4_000_000 },
  { name: "온라인 상세페이지 리뉴얼 5종", description: "모바일 우선, 촬영 별도", price: 5_000_000 },
  { name: "오프라인 매장 POP 디자인", price: 2_000_000 },
]);

// 6) 자료(메모·링크)
check(
  "자료",
  await sb.from("source_assets").insert([
    { workspace_id: ws, client_id: clientA, project_id: pA1, kind: "text", text_content: "사장님 요청: 기존 로고의 커피잔 모양은 살려 주세요.", upload_status: "stored" },
    { workspace_id: ws, client_id: clientA, kind: "url", url: "https://example.com/cafe-ondo/instagram", upload_status: "stored" },
    { workspace_id: ws, client_id: clientB, project_id: pB1, kind: "text", file_name: "상담 메모", text_content: "랜딩에는 수수료 표를 꼭 넣기", upload_status: "stored" },
  ]),
);

const counts = {
  고객: 3,
  프로젝트: 7,
  진행중_프로젝트: "접수·자료대기·진행·검토 6개",
  납기_7일_이내: "A 로고(3일), B 상담(1일), 자체 블로그(5일), B 계약(2일 지남)",
  확정_견적: 1,
};
console.log("검수용 예시 데이터를 만들었습니다:", JSON.stringify(counts));
