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

// ─────────────────────────────────────────────
// 업무실 이름 (AUDIT-05 C3, WORKSPACE-RENAME-BACKEND-01)
// 로그인 역할에는 workspaces 쓰기 권한이 없다(PERM-CLEANUP). 정의자 RPC rename_workspace 로만 바꾼다.
// expectedRevision = 이 화면이 읽어 온 revision. 그사이 다른 곳에서 바꿨으면 덮어쓰지 않고 CONFLICT.
// ─────────────────────────────────────────────
export const WORKSPACE_NAME_MAX = 200;
export const WORKSPACE_CONFLICT_MESSAGE = "다른 곳에서 먼저 업무실 이름을 바꿨습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.";

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "업무실 이름을 입력해 주세요.")
  .max(WORKSPACE_NAME_MAX, `업무실 이름은 ${WORKSPACE_NAME_MAX}자까지 입력할 수 있습니다.`);

export interface WorkspaceSettings {
  name: string;
  revision: number;
}

export async function getWorkspaceSettings(): Promise<WorkspaceSettings | null> {
  const { workspace } = await requireWorkspace();
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.from("workspaces").select("name, revision").eq("id", workspace.id).maybeSingle();
  if (error) throw new Error(`업무실 정보를 불러오지 못했습니다: ${error.message}`);
  return (data as WorkspaceSettings | null) ?? null;
}

type RenameRpc = {
  rpc: (fn: "rename_workspace", args: { p_name: string; p_expected_revision: number }) => PromiseLike<{
    data: number | null;
    error: { code?: string; message: string } | null;
  }>;
};

export async function renameWorkspace(name: string, expectedRevision: number): Promise<Result<{ revision: number }>> {
  const parsed = workspaceNameSchema.safeParse(name);
  if (!parsed.success) return fail("VALIDATION", parsed.error.issues[0]?.message ?? "업무실 이름을 확인해 주세요.");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return fail("CONFLICT", WORKSPACE_CONFLICT_MESSAGE);
  await requireWorkspace();
  const sb = (await createSupabaseServerClient()) as unknown as RenameRpc;
  const { data, error } = await sb.rpc("rename_workspace", { p_name: parsed.data, p_expected_revision: expectedRevision });
  if (!error && typeof data === "number") return ok({ revision: data });
  if (error?.message?.includes("CONFLICT")) return fail("CONFLICT", WORKSPACE_CONFLICT_MESSAGE);
  if (error?.message?.includes("VALIDATION")) return fail("VALIDATION", "업무실 이름은 1~200자로 입력해 주세요.");
  if (error) return fromDbError("renameWorkspace", { code: error.code ?? "", message: error.message });
  return fail("ERROR", "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
