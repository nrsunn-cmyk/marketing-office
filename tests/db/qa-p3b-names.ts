/**
 * QA-P3B-PREP-01(Tester): P3-b 홈페이지 구조·문구 공격 시험이 쓰는 이름·인자·한도를 한곳에 모은다.
 * 근거: Plan/Claude-Backend-20261120/P3B-BACKEND-01-DESIGN.md(2·4·7절). 구현에서 이름·인자가 바뀌면 이 파일만 고친다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const P3B = {
  docs: "web_copy_docs",
  versions: "web_copy_versions",
  auditEntity: "web_copy_doc",
  rpc: {
    create: "create_web_copy_doc",
    save: "save_web_copy",
    restore: "restore_web_copy_version",
    rebase: "rebase_web_copy",
    archive: "archive_web_copy",
  },
  /** P3-a 제작 브리프(바탕) — 시험 준비용 */
  brief: {
    table: "production_briefs",
    create: "create_production_brief",
    update: "update_production_brief",
    archive: "archive_production_brief",
  },
  limits: {
    pagesMax: 10,
    sectionsPerPageMax: 12,
    sectionsTotalMax: 60,
    citationsMax: 10,
    versionsMax: 100,
    docsPerBrief: 10,
    pageTitle: 60,
    slug: 80,
    sectionName: 80,
    purpose: 200,
    headline: 160,
    body: 2000,
    ctaLabel: 60,
    ctaTarget: 200,
  },
  statuses: ["drafting", "reviewed"] as const,
  err: {
    notFound: /NOT_FOUND/,
    invalid: /INVALID_TRANSITION/,
    validation: /VALIDATION/,
    conflict: /CONFLICT/,
    limit: /LIMIT_REACHED/,
    denied: /permission denied/,
    frozen:
      /IMMUTABLE_ROW|FROZEN_COLUMN|INVALID_TRANSITION|바꿀 수 없|추가 전용|append|not allowed|reject/i,
  },
} as const;

export type Section = {
  id: string | null;
  section_name: string;
  purpose: string | null;
  headline: string;
  body: string | null;
  cta_label: string | null;
  cta_target: string | null;
  citation_ids: string[];
  sort_order: number;
  excluded: boolean;
} & Record<string, unknown>;
export type Page = {
  id: string | null;
  title: string;
  slug: string;
  sort_order: number;
  sections: Section[];
} & Record<string, unknown>;

export const newSection = (
  i: number,
  over: Partial<Section> = {},
): Section => ({
  id: null,
  section_name: `섹션 ${i}`,
  purpose: null,
  headline: `헤드라인 ${i}`,
  body: null,
  cta_label: null,
  cta_target: null,
  citation_ids: [],
  sort_order: i,
  excluded: false,
  ...over,
});
export const newPage = (
  i: number,
  slug: string,
  sections: Section[] = [newSection(1)],
): Page => ({ id: null, title: `페이지 ${i}`, slug, sort_order: i, sections });

/** RPC 호출 SQL(설계 4절 인자 순서). 바뀌면 여기만 고친다 */
export const sql = {
  create: (briefId: string, copyFrom: string | null = null) => ({
    text: `select ${P3B.rpc.create}($1, $2) as id`,
    params: [briefId, copyFrom],
  }),
  save: (docId: string, rev: number, status: string, pages: unknown) => ({
    text: `select ${P3B.rpc.save}($1, $2, $3, $4::jsonb) as r`,
    params: [docId, rev, status, JSON.stringify(pages)],
  }),
  restore: (docId: string, rev: number, versionNo: number) => ({
    text: `select ${P3B.rpc.restore}($1, $2, $3) as r`,
    params: [docId, rev, versionNo],
  }),
  rebase: (docId: string, rev: number) => ({
    text: `select ${P3B.rpc.rebase}($1, $2) as r`,
    params: [docId, rev],
  }),
  archive: (docId: string, rev: number) => ({
    text: `select ${P3B.rpc.archive}($1, $2) as r`,
    params: [docId, rev],
  }),
};

/** 마이그레이션에 표가 아직 없으면 시험을 건너뛴다 */
export function p3bMigrationPresent(): boolean {
  const dir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
  const re = new RegExp(
    `create table (if not exists )?public\\.${P3B.docs}\\b`,
    "i",
  );
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .some((f) => re.test(readFileSync(join(dir, f), "utf8")));
}
