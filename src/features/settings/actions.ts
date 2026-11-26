"use server";

import { refresh } from "next/cache";
import { fieldErrors, type FormState } from "@/app/_components/form-state";
import { WORKSPACE_RENAME_SAVED } from "@/app/settings/workspace-name-copy";
import { renameWorkspace, saveSupplierVersion, supplierInputSchema } from "./server";

export async function saveSupplierAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const text = (k: string) => String(fd.get(k) ?? "");
  const parsed = supplierInputSchema.safeParse({
    legalName: text("legalName"),
    representative: text("representative"),
    businessNumber: text("businessNumber"),
    businessType: text("businessType"),
    businessItem: text("businessItem"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    contactPerson: text("contactPerson"),
    bankAccount: text("bankAccount"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error.issues) };
  // 이 화면이 읽어 온 버전(CR10). 숫자가 아니면 어떤 버전과도 맞지 않게 -1.
  const base = text("baseVersion");
  const baseVersion = /^\d{1,9}$/.test(base) ? Number(base) : -1;
  const r = await saveSupplierVersion(parsed.data, baseVersion);
  if (!r.ok) return { message: r.message };
  refresh();
  return { ok: true, message: `공급자 정보 ${r.data.version}번 버전을 저장했습니다. 이후 확정하는 견적서부터 적용됩니다.` };
}

/**
 * 업무실 이름 바꾸기(WORKSPACE-RENAME-FRONT-01, AUDIT-05 C3). Backend 8b48353 renameWorkspace 를 그대로 부른다.
 * revision 은 화면이 읽어 온 값. 숫자가 아니면 0 → 서버가 CONFLICT 로 돌려준다.
 */
export async function renameWorkspaceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const name = String(fd.get("workspaceName") ?? "");
  const rev = String(fd.get("revision") ?? "");
  const revision = /^\d{1,9}$/.test(rev) ? Number(rev) : 0;
  const r = await renameWorkspace(name, revision);
  if (!r.ok) return r.code === "VALIDATION" ? { errors: { workspaceName: r.message } } : { message: r.message };
  refresh(); // 머리말 등 업무실 이름을 보여 주는 곳을 새로 그린다
  return { ok: true, message: WORKSPACE_RENAME_SAVED };
}
