"use server";

import { redirect } from "next/navigation";
import { workspaceSetupSchema } from "@/contracts";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/supabase/server";

export interface SetupState {
  errors?: Partial<Record<string, string>>;
  message?: string;
}

/** 업무실 처음 설정. DB 함수 setup_workspace 가 업무실·공급자 정보를 한 번에 만든다. */
export async function setupWorkspace(_prev: SetupState, formData: FormData): Promise<SetupState> {
  await requireUser();
  const parsed = workspaceSetupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { errors };
  }
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("setup_workspace", {
    p_name: v.name,
    p_legal_name: v.legalName,
    p_representative: v.representative,
    p_business_number: v.businessNumber,
    p_phone: v.phone,
    p_email: v.email,
    p_address: v.address,
  });
  if (error) {
    console.error("[setup] 업무실 생성 실패:", error.code, error.message);
    return { message: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  redirect("/");
}
