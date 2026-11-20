/**
 * QA-P3E-PREP-01(Tester): P3-e PPT 구성·내보내기 공격 시험이 쓰는 이름·인자·한도·모듈 경로를 한곳에 모은다.
 * 근거: Plan/Claude-Backend-20261120/P3E-BACKEND-01-DESIGN.md(D1 A안·이미지 제외) + Backend 구현 claude/p3e-ppt-backend
 *       4799599(migration 20261121010000)의 선언. 바뀌면 이 파일만 고친다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

export const P3E = {
  migrationTable: "ppt_decks",
  tables: { decks: "ppt_decks", versions: "ppt_deck_versions" },
  auditEntity: "ppt_deck",
  deliverable: "ppt_deck",
  templates: ["royal_grid", "minimal_report", "brand_deck"] as const,
  statuses: ["drafting", "reviewed"] as const,
  rpc: {
    create: "create_ppt_deck",
    save: "save_ppt_deck",
    restore: "restore_ppt_deck_version",
    rebase: "rebase_ppt_deck",
    archive: "archive_ppt_deck",
  },
  limits: {
    slides: 40,
    versions: 20,
    assetsPerSlide: 10,
    active: 5,
    total: 10,
    deckTitle: 120,
    slideTitle: 100,
    bullets: 1000,
    notes: 1000,
    fileName: 60,
    /** 내려받기 응답 상한(Vercel 함수 응답) */
    responseBytes: 4.5 * 1024 * 1024,
  },
  /** 저장 때 거절할 제어 문자(줄바꿈·CR·탭은 허용) */
  controlChars: [
    "\u0001",
    "\u0008",
    "\u000B",
    "\u000C",
    "\u000E",
    "\u001F",
    "\u007F",
  ],
  /** 모듈(앱 루트 기준). 없으면 그 시험만 건너뛴다 */
  modules: {
    domain: "src/domain/ppt-decks/index.ts",
    text: "src/server/export/text.ts",
    md: "src/server/export/md.ts",
    pptx: "src/server/export/pptx.ts",
    zip: "src/server/export/zip.ts",
    route: "src/app/ppt-decks/[deckId]/export/route.ts",
  },
  /** 대체 파일 이름(사용자 글 없음) */
  fallbackName: "PPT-구성안",
} as const;

export const modulePath = (k: keyof typeof P3E.modules) =>
  join(ROOT, P3E.modules[k]);
export const modulePresent = (k: keyof typeof P3E.modules) =>
  existsSync(modulePath(k));

/** migration 에 ppt_decks 가 있는가 */
export function p3eMigrationPresent(): boolean {
  const dir = join(ROOT, "supabase", "migrations");
  return readdirSync(dir).some(
    (f) =>
      f.endsWith(".sql") &&
      readFileSync(join(dir, f), "utf8").includes(
        `create table public.${P3E.migrationTable}`,
      ),
  );
}

/** RPC 입력 슬라이드(snake_case, asset_ids) */
export type SlideIn = {
  id: string | null;
  title: string;
  bullets: string | null;
  notes: string | null;
  asset_ids: string[];
};
export const slide = (o: Partial<SlideIn> = {}): SlideIn => ({
  id: null,
  title: "합성 슬라이드",
  bullets: null,
  notes: null,
  asset_ids: [],
  ...o,
});
export const slides = (
  n: number,
  f: (i: number) => Partial<SlideIn> = () => ({}),
) =>
  Array.from({ length: n }, (_, i) =>
    slide({ title: `슬라이드 ${i + 1}`, ...f(i) }),
  );

export const sql = {
  create: (briefId: string, title: string, template: string, s: unknown) => ({
    text: `select ${P3E.rpc.create}($1, $2, $3, $4::jsonb) as r`,
    params: [briefId, title, template, JSON.stringify(s)],
  }),
  save: (
    deckId: string,
    rev: number,
    title: string,
    template: string,
    status: string,
    s: unknown,
  ) => ({
    text: `select ${P3E.rpc.save}($1, $2, $3, $4, $5, $6::jsonb) as r`,
    params: [deckId, rev, title, template, status, JSON.stringify(s)],
  }),
  restore: (deckId: string, rev: number, v: number) => ({
    text: `select ${P3E.rpc.restore}($1, $2, $3) as r`,
    params: [deckId, rev, v],
  }),
  rebase: (deckId: string, rev: number) => ({
    text: `select ${P3E.rpc.rebase}($1, $2) as r`,
    params: [deckId, rev],
  }),
  archive: (deckId: string, rev: number) => ({
    text: `select ${P3E.rpc.archive}($1, $2) as r`,
    params: [deckId, rev],
  }),
};
