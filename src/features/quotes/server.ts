import "server-only";
import { createHash } from "node:crypto";
import { canonicalJson } from "@/domain/canonical";
import { calculateDraft, parseQuoteForm, type QuoteDraft, type QuoteFormText } from "@/domain/quote/form";
import type { TaxMode } from "@/domain/quote";
import { getTaskDetail, type TaskDetail } from "@/features/tasks/server";
import { requireWorkspace } from "@/server/auth/session";
import { CONFLICT_MESSAGE, fail, fromDbError, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";
import type { QuoteDocument } from "./document";

/** 견적 결과물 내용 (artifact_versions.content) */
export interface QuoteContent {
  form: QuoteDraft;
  totals: { subtotalWon: number; taxWon: number; totalWon: number; isFinalizable: boolean };
  customer: { name: string };
}

export interface SupplierRow {
  id: string;
  version: number;
  legal_name: string;
  representative: string | null;
  business_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface FinalQuote {
  id: string;
  quote_number: string;
  artifact_version_id: string;
  total_won: number;
  issue_date: string | null;
  created_at: string;
}

/** DB 함수는 null 인자를 받지만, 생성된 타입은 null을 표현하지 못해 의도를 드러내는 변환을 둔다 */
const sqlNull = <T>(v: T | null | undefined): T => (v ?? null) as T;

const customerOf = (d: TaskDetail) => ({ name: d.client?.name ?? d.project.title });

export async function latestSupplier(): Promise<SupplierRow | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data } = await sb
    .from("supplier_profiles")
    .select("id, version, legal_name, representative, business_number, phone, email, address")
    .eq("workspace_id", workspace.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function listFinalQuotes(artifactId: string): Promise<FinalQuote[]> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("quote_versions")
    .select("id, artifact_version_id, total_won, issue_date, created_at, quotes(quote_number)")
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`확정 견적을 불러오지 못했습니다: ${error.message}`);
  return (data as unknown as Array<FinalQuote & { quotes: { quote_number: string } }>).map((r) => ({
    ...r,
    quote_number: r.quotes.quote_number,
    total_won: Number(r.total_won),
  }));
}

/** 견적 초안 저장. 화면이 본 revision(처음이면 null)과 같을 때만 저장한다 (T13). */
export async function saveQuoteDraft(
  taskId: string,
  expectedRevision: number | null,
  form: QuoteFormText,
): Promise<Result<{ version: number }, Record<string, string>>> {
  const parsed = parseQuoteForm(form);
  if (!parsed.ok) return { ok: false, code: "VALIDATION", message: "입력을 확인해 주세요.", errors: parsed.errors };
  const detail = await getTaskDetail(taskId);
  if (!detail) return fail("NOT_FOUND", "작업을 찾을 수 없습니다.");
  if (detail.task.type !== "quote") return fail("VALIDATION", "견적 작업이 아닙니다.");

  const calc = calculateDraft(parsed.draft);
  const customer = customerOf(detail);
  const content: QuoteContent = {
    form: parsed.draft,
    totals: { subtotalWon: calc.subtotalWon, taxWon: calc.taxWon, totalWon: calc.totalWon, isFinalizable: calc.isFinalizable },
    customer,
  };
  const snapshot = {
    project: { id: detail.project.id, title: detail.project.title, kind: detail.project.kind },
    client: detail.client,
    customer,
  };
  const hash = createHash("sha256").update(canonicalJson({ snapshot, form: parsed.draft })).digest("hex");

  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .rpc("save_draft_version", {
      p_task_id: taskId,
      p_expected_revision: sqlNull(expectedRevision),
      p_input_hash: hash,
      p_snapshot: snapshot as unknown as Json,
      p_content: content as unknown as Json,
    })
    .single();
  if (error) {
    if (error.message.includes("CONFLICT")) return fail("CONFLICT", CONFLICT_MESSAGE);
    return fromDbError("saveQuoteDraft", error);
  }
  return ok({ version: data.version });
}

/**
 * 견적 확정. 서버에서 다시 계산하고, DB도 한 번 더 계산해 맞지 않으면 거절한다.
 * 확정되면 견적 번호가 붙고 금액·공급자·고객 정보가 고정된다.
 */
export async function finalizeQuote(taskId: string, versionId: string): Promise<Result<{ quoteNumber: string; reused: boolean }>> {
  const detail = await getTaskDetail(taskId);
  if (!detail?.artifact) return fail("NOT_FOUND", "견적을 찾을 수 없습니다.");
  if (detail.artifact.current_draft_version_id !== versionId) {
    return fail("CONFLICT", "최신 버전이 아닙니다. 화면을 새로 고친 뒤 다시 확정해 주세요.");
  }
  const version = detail.versions.find((v) => v.id === versionId);
  const content = version?.content as unknown as QuoteContent | undefined;
  if (!content?.form) return fail("NOT_FOUND", "견적 내용을 찾을 수 없습니다.");

  const calc = calculateDraft(content.form);
  if (!calc.isFinalizable) {
    return fail("VALIDATION", `확정할 수 없습니다: ${[...new Set(calc.issues.map((i) => i.message))].join(" ")}`);
  }
  const supplier = await latestSupplier();
  if (!supplier) return fail("VALIDATION", "공급자(우리 회사) 정보가 없습니다. 업무실 설정을 확인해 주세요.");

  const items = content.form.items.map((it, i) => ({
    name: it.name,
    description: it.description,
    quantity_hundredths: it.quantityHundredths,
    unit_price_won: it.unitPriceWon,
    line_amount_won: calc.lines[i].amountWon,
  }));
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .rpc("finalize_quote", {
      p_artifact_id: detail.artifact.id,
      p_version_id: versionId,
      p_supplier_profile_id: supplier.id,
      p_supplier_snapshot: supplier as unknown as Json,
      p_customer_snapshot: content.customer as unknown as Json,
      p_tax_mode: content.form.taxMode,
      p_tax_rate_bp: content.form.taxRateBasisPoints,
      p_subtotal_won: calc.subtotalWon,
      p_tax_won: calc.taxWon,
      p_total_won: calc.totalWon,
      p_issue_date: content.form.issueDate as string,
      p_valid_until: sqlNull(content.form.validUntil),
      p_payment_terms: sqlNull(content.form.paymentTerms),
      p_notes: sqlNull(content.form.notes),
      p_items: items as unknown as Json,
    })
    .single();
  if (error) {
    if (error.message.includes("CONFLICT")) return fail("CONFLICT", "최신 버전이 아닙니다. 화면을 새로 고친 뒤 다시 확정해 주세요.");
    if (error.message.includes("AMOUNT_MISMATCH")) {
      console.error("[finalizeQuote] 금액 불일치", error.message);
      return fail("ERROR", "금액 검증에 실패해 확정하지 않았습니다. 관리자에게 알려 주세요.");
    }
    return fromDbError("finalizeQuote", error);
  }
  return ok({ quoteNumber: data.quote_number, reused: data.reused });
}

/** 확정된 견적의 PDF용 내용. DB에 고정된 값만 쓴다(이후 고객·공급자 정보가 바뀌어도 그대로, R06). */
export async function getQuoteDocument(quoteVersionId: string): Promise<QuoteDocument | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data: qv, error } = await sb
    .from("quote_versions")
    .select(
      "id, artifact_id, supplier_snapshot, customer_snapshot, tax_mode, tax_rate_bp, subtotal_won, tax_won, total_won, issue_date, valid_until, payment_terms, notes, quotes(quote_number)",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", quoteVersionId)
    .maybeSingle();
  if (error) throw new Error(`견적을 불러오지 못했습니다: ${error.message}`);
  if (!qv) return null;
  // quote_versions 와 artifacts 사이에는 직접 외래키가 없어(복합 키로 연결) 프로젝트 제목은 따로 읽는다
  const { data: art } = await sb.from("artifacts").select("projects(title)").eq("id", qv.artifact_id).maybeSingle();
  const projectTitle = (art as unknown as { projects: { title: string } } | null)?.projects.title ?? "";
  const { data: items } = await sb
    .from("quote_items")
    .select("position, name, description, quantity_hundredths, unit_price_won, line_amount_won")
    .eq("quote_version_id", quoteVersionId)
    .order("position");

  const row = qv as unknown as {
    supplier_snapshot: SupplierRow;
    customer_snapshot: { name: string };
    tax_mode: TaxMode;
    tax_rate_bp: number;
    subtotal_won: number;
    tax_won: number;
    total_won: number;
    issue_date: string | null;
    valid_until: string | null;
    payment_terms: string | null;
    notes: string | null;
    quotes: { quote_number: string };
  };
  const sup = row.supplier_snapshot;
  return {
    status: "final",
    quoteNumber: row.quotes.quote_number,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    projectTitle,
    supplier: {
      legalName: sup.legal_name,
      representative: sup.representative,
      businessNumber: sup.business_number,
      phone: sup.phone,
      email: sup.email,
      address: sup.address,
    },
    customer: { name: row.customer_snapshot.name },
    items: (items ?? []).map((it) => ({
      position: it.position,
      name: it.name,
      description: it.description,
      quantityHundredths: Number(it.quantity_hundredths),
      unitPriceWon: Number(it.unit_price_won),
      lineAmountWon: Number(it.line_amount_won),
    })),
    taxMode: row.tax_mode,
    taxRateBasisPoints: row.tax_rate_bp,
    subtotalWon: Number(row.subtotal_won),
    taxWon: Number(row.tax_won),
    totalWon: Number(row.total_won),
    paymentTerms: row.payment_terms,
    notes: row.notes,
  };
}

/** 업무실 시간대 기준 오늘 (YYYY-MM-DD) */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
