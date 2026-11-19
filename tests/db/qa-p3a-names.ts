/**
 * QA-P3A-PREP-01(Tester): P3-a 공통 제작 브리프 공격 시험이 쓰는 이름·인자 순서·한도를 한곳에 모은다.
 * 근거: Plan/Claude-Backend-20261120/P3A-BACKEND-01-DESIGN.md(D1~D13). 구현에서 이름·인자가 바뀌면 이 파일만 고친다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const P3A = {
  table: "production_briefs",
  auditEntity: "production_brief",
  rpc: {
    create: "create_production_brief",
    update: "update_production_brief",
    rebase: "rebase_production_brief",
    archive: "archive_production_brief",
  },
  /** 한 프로젝트에 보관 안 된 브리프 상한(D8) */
  limit: 10,
  /** 글자 수 상한(코드 포인트, 앞뒤 공백 정리 뒤, 설계 2-1). min 0 = 비면 null */
  fields: {
    title: { min: 1, max: 120 },
    targetAudience: { min: 1, max: 500 },
    coreMessage: { min: 1, max: 1000 },
    scopeSummary: { min: 1, max: 2000 },
    brandToneConstraints: { min: 0, max: 1000 },
    referenceNotes: { min: 0, max: 1000 },
  },
  deliverables: [
    "web_copy",
    "design_assets",
    "video_plan",
    "ppt_deck",
  ] as const,
  statuses: ["drafting", "ready"] as const,
  /** 오류 문구 앞머리(코드) */
  err: {
    notFound: /NOT_FOUND/,
    notApproved: /STRATEGY_NOT_APPROVED/,
    invalid: /INVALID_TRANSITION/,
    validation: /VALIDATION/,
    conflict: /CONFLICT/,
    limit: /LIMIT_REACHED/,
    denied: /permission denied/,
    fk: /foreign key|violates/,
    frozen: /FROZEN_COLUMN|바꿀 수 없|cannot|immutable/i,
  },
} as const;

export type BriefInput = {
  title: string;
  targetAudience: string;
  coreMessage: string;
  deliverables: unknown;
  scopeSummary: string;
  brandToneConstraints: string | null;
  referenceNotes: string | null;
};

export const DEFAULT_INPUT: BriefInput = {
  title: "합성 제작 브리프",
  targetAudience: "합성 대상 고객",
  coreMessage: "합성 핵심 메시지",
  deliverables: ["web_copy", "ppt_deck"],
  scopeSummary: "합성 제작 범위와 목표",
  brandToneConstraints: null,
  referenceNotes: null,
};

/** RPC 호출 SQL과 인자(설계 3절 순서). 인자 순서가 바뀌면 여기만 고친다. */
export const sql = {
  create: (projectId: string, strategyArtifactId: string, v: BriefInput) => ({
    text: `select ${P3A.rpc.create}($1, $2, $3, $4, $5, $6::text[], $7, $8, $9) as id`,
    params: [
      projectId,
      strategyArtifactId,
      v.title,
      v.targetAudience,
      v.coreMessage,
      v.deliverables,
      v.scopeSummary,
      v.brandToneConstraints,
      v.referenceNotes,
    ],
  }),
  update: (briefId: string, rev: number, v: BriefInput, status: string) => ({
    text: `select ${P3A.rpc.update}($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10) as r`,
    params: [
      briefId,
      rev,
      v.title,
      v.targetAudience,
      v.coreMessage,
      v.deliverables,
      v.scopeSummary,
      v.brandToneConstraints,
      v.referenceNotes,
      status,
    ],
  }),
  rebase: (briefId: string, rev: number) => ({
    text: `select ${P3A.rpc.rebase}($1, $2) as r`,
    params: [briefId, rev],
  }),
  archive: (briefId: string, rev: number) => ({
    text: `select ${P3A.rpc.archive}($1, $2) as r`,
    params: [briefId, rev],
  }),
};

/** 마이그레이션에 표가 아직 없으면 시험을 건너뛴다(Backend migration 28 이 오기 전). */
export function p3aMigrationPresent(): boolean {
  const dir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
  const re = new RegExp(
    `create table (if not exists )?public\\.${P3A.table}\\b`,
    "i",
  );
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .some((f) => re.test(readFileSync(join(dir, f), "utf8")));
}
