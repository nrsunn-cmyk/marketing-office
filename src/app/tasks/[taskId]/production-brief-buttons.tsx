"use client";

import type { ReactNode } from "react";
import { ActionForm } from "../../_components/action-form";
import f from "./funnel.module.css";
import { notConnectedAction, type BriefAction } from "./production-brief-edit-form";

/**
 * 만들기·맞추기·보관처럼 값 없이 누르는 단추(P3A-UI-PREP-01).
 * 서버 동작이 아직 없으면 자리용 동작(안내만)을 쓴다. 서버 컴포넌트에서 함수를 넘기지 않아도 되도록 여기서 고른다.
 */
export function BriefActionButton({
  action,
  hidden,
  submitLabel,
  pendingLabel,
  variant = "secondary",
  children,
}: {
  action?: BriefAction;
  hidden: Record<string, string | number>;
  submitLabel: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
  children?: ReactNode;
}) {
  return (
    <ActionForm action={action ?? notConnectedAction} submitLabel={submitLabel} pendingLabel={pendingLabel} variant={variant} className={f.inlineForm}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      {children}
    </ActionForm>
  );
}
