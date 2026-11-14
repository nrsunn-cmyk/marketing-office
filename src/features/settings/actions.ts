"use server";

import { refresh } from "next/cache";
import { fieldErrors, type FormState } from "@/app/_components/form-state";
import { saveSupplierVersion, supplierInputSchema } from "./server";

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
