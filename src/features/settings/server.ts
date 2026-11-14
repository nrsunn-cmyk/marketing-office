import "server-only";
import { z } from "zod";
import { requireWorkspace } from "@/server/auth/session";
import { fail, fromDbError, ok, type Result } from "@/server/result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/server/supabase/database.types";

/**
 * 공급자(우리 회사) 정보 — 견적서의 '공급자' 칸.
 * 바꿀 때마다 새 버전을 추가한다. 이미 확정한 견적서는 확정할 때의 정보를 그대로 쓴다(R06).
 * 업태·종목·담당자·입금 계좌는 표준 견적서 항목이라 extra(JSON)에 담는다.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v ? v : null));

export const supplierInputSchema = z.object({
  legalName: z.string().trim().min(1, "상호를 입력해 주세요.").max(200),
  representative: optional(100),
  businessNumber: optional(20),
  businessType: optional(100),
  businessItem: optional(200),
  address: optional(500),
  phone: optional(50),
  email: z
    .string()
    .trim()
    .max(320)
    .refine((v) => v === "" || z.email().safeParse(v).success, "이메일 형식이 올바르지 않습니다.")
    .transform((v) => (v ? v : null)),
  contactPerson: optional(100),
  bankAccount: optional(200),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;

export interface SupplierExtra {
  business_type?: string | null;
  business_item?: string | null;
  contact_person?: string | null;
  bank_account?: string | null;
}

export interface Supplier {
  id: string;
  version: number;
  legal_name: string;
  representative: string | null;
  business_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  extra: SupplierExtra;
  created_at: string;
}

export async function getSupplier(): Promise<Supplier | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("supplier_profiles")
    .select("id, version, legal_name, representative, business_number, phone, email, address, extra, created_at")
    .eq("workspace_id", workspace.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`공급자 정보를 불러오지 못했습니다: ${error.message}`);
  return data ? { ...data, extra: (data.extra ?? {}) as SupplierExtra } : null;
}

/** 다른 화면에서 먼저 저장한 경우 안내 문구(CR10) */
export const SUPPLIER_CONFLICT_MESSAGE =
  "다른 화면에서 공급자 정보가 먼저 저장되었습니다. 덮어쓰지 않았습니다. 화면을 새로 고쳐 최신 내용을 확인한 뒤 다시 저장해 주세요.";

/**
 * 새 버전으로 저장한다.
 * baseVersion = 이 화면이 읽어 온 버전(없으면 0). 그사이 다른 화면에서 저장했으면 덮어쓰지 않고 CONFLICT(CR10).
 * 거의 동시에 저장해도 (업무실, 버전) 유일 제약이 하나만 받아들이고 나머지는 CONFLICT — 다시 시도하지 않는다.
 */
export async function saveSupplierVersion(input: SupplierInput, baseVersion: number): Promise<Result<{ version: number }>> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const current = await getSupplier();
  if ((current?.version ?? 0) !== baseVersion) return fail("CONFLICT", SUPPLIER_CONFLICT_MESSAGE);
  const version = baseVersion + 1;
  const extra: SupplierExtra = {
    business_type: input.businessType,
    business_item: input.businessItem,
    contact_person: input.contactPerson,
    bank_account: input.bankAccount,
  };
  const { error } = await sb.from("supplier_profiles").insert({
    workspace_id: workspace.id,
    version,
    legal_name: input.legalName,
    representative: input.representative,
    business_number: input.businessNumber,
    phone: input.phone,
    email: input.email,
    address: input.address,
    extra: extra as unknown as NonNullable<Json>,
  });
  if (!error) return ok({ version });
  if (error.code === "23505") return fail("CONFLICT", SUPPLIER_CONFLICT_MESSAGE);
  return fromDbError("saveSupplierVersion", error);
}
