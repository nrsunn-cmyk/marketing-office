/** P2G-BACKEND-01: 채널 초안 도메인 시험(주소 표 R1-2, 게시 시각, 입력 경계 L6). DB 쪽 같은 표 대조는 tests/db/p2-channel-draft.test.ts */
import { describe, expect, it } from "vitest";
import { PUBLICATION_URL_CASES } from "../../../tests/fixtures/publication-url-cases";
import {
  CHANNEL_DRAFT_LIMITS,
  PUBLICATION_URL_RE,
  channelDraftDisplayStatus,
  channelDraftErrorFromDb,
  channelDraftInputSchema,
  draftTrim,
  isSafeHttpsUrl,
  isTistoryHost,
  normalizePublicationUrl,
  parsePublishedAt,
  splitTags,
} from "./index";
import { exportFileName } from "./render";

describe("게시 주소 표(R1-2) — 앱 정규화와 JS 식", () => {
  for (const c of PUBLICATION_URL_CASES) {
    it(JSON.stringify(c.raw).slice(0, 80), () => {
      const r = normalizePublicationUrl(c.raw);
      expect(r.ok ? r.url : null).toBe(c.app);
      // DB 와 같은 식을 JS 로: RPC(앞뒤 정리 뒤)·CHECK(그대로)
      const t = draftTrim(c.raw);
      expect(t.length <= 2048 && PUBLICATION_URL_RE.test(t), "rpc").toBe(c.rpc);
      expect(isSafeHttpsUrl(c.raw), "check").toBe(c.check);
      // 앱이 통과시킨 값은 늘 DB 식도 통과한다(정규화한 값만 보낸다)
      if (r.ok) expect(isSafeHttpsUrl(r.url)).toBe(true);
    });
  }
  it("문자열이 아니면 거절", () => {
    for (const v of [null, undefined, 1, {}, ["https://a.com"]]) expect(normalizePublicationUrl(v).ok).toBe(false);
  });
  it("티스토리 주소 안내(막지 않음)", () => {
    expect(isTistoryHost("https://a.tistory.com/1")).toBe(true);
    expect(isTistoryHost("https://tistory.com/1")).toBe(true);
    expect(isTistoryHost("https://evil-tistory.com/1")).toBe(false);
    expect(isTistoryHost("https://tistory.com.evil.com/1")).toBe(false);
    expect(isTistoryHost("not a url")).toBe(false);
  });
});

describe("게시 시각", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  it("시간대 없는 값은 한국 시간", () => {
    expect(parsePublishedAt("2026-11-19T21:00", now)).toEqual({ ok: true, iso: "2026-11-19T12:00:00.000Z" });
    expect(parsePublishedAt("2026-11-19T21:00:30", now)).toEqual({ ok: true, iso: "2026-11-19T12:00:30.000Z" });
    expect(parsePublishedAt("2026-11-19T11:00:00Z", now)).toEqual({ ok: true, iso: "2026-11-19T11:00:00.000Z" });
    expect(parsePublishedAt("2026-11-19T20:00:00+09:00", now)).toEqual({ ok: true, iso: "2026-11-19T11:00:00.000Z" });
  });
  it("미래 5분까지만, 2000년 이전 거절, 형식 오류 거절", () => {
    expect(parsePublishedAt("2026-11-19T21:05", now).ok).toBe(true);
    expect(parsePublishedAt("2026-11-19T21:05:01", now)).toEqual({ ok: false, message: "게시 시각이 미래입니다." });
    expect(parsePublishedAt("2000-01-01T00:00", now).ok).toBe(true);
    expect(parsePublishedAt("1999-12-31T23:59:59+09:00", now).ok).toBe(false);
    for (const v of ["", "2026-11-19", "2026-13-01T00:00", "어제", "2026-11-19 21:00", null, 1]) expect(parsePublishedAt(v, now).ok, String(v)).toBe(false);
  });
});

describe("입력 계약(L6 경계, 글자 수는 코드 포인트)", () => {
  const base = { title: "제목", body: "", tags: [], status: "drafting" };
  const parse = (o: object) => channelDraftInputSchema.safeParse({ ...base, ...o });
  it("본문 20000자 통과·20001자 거절(이모지는 1자), 줄바꿈 정리", () => {
    expect(parse({ body: "가".repeat(20000) }).success).toBe(true);
    expect(parse({ body: "😀".repeat(20000) }).success).toBe(true);
    expect(parse({ body: "가".repeat(20001) }).success).toBe(false);
    expect(parse({ body: "😀".repeat(20001) }).success).toBe(false);
    const r = parse({ body: "  a\r\nb\rc  " });
    expect(r.success && r.data.body).toBe("a\nb\nc");
  });
  it("제목: 공백만·NBSP·BOM 만 거절, 200자 경계", () => {
    for (const t of ["", "   ", " ﻿"]) expect(parse({ title: t }).success, JSON.stringify(t)).toBe(false);
    expect(parse({ title: "가".repeat(200) }).success).toBe(true);
    expect(parse({ title: "가".repeat(201) }).success).toBe(false);
  });
  it("태그: 10개·30자·빈 태그·대소문자 중복", () => {
    expect(parse({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) }).success).toBe(true);
    expect(parse({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(parse({ tags: ["가".repeat(30)] }).success).toBe(true);
    expect(parse({ tags: ["가".repeat(31)] }).success).toBe(false);
    expect(parse({ tags: [" "] }).success).toBe(false);
    expect(parse({ tags: ["SEO", "seo"] }).success).toBe(false);
    expect(parse({ tags: [" 마케팅 "] }).data?.tags).toEqual(["마케팅"]);
    expect(splitTags("마케팅, 브랜딩\n, ,SEO")).toEqual(["마케팅", "브랜딩", "SEO"]);
  });
  it("메타 설명 300·이미지 안내 500, 빈 값은 null, 모르는 키·상태 거절", () => {
    expect(parse({ metaDescription: "가".repeat(300), imageNote: "가".repeat(500) }).success).toBe(true);
    expect(parse({ metaDescription: "가".repeat(301) }).success).toBe(false);
    expect(parse({ imageNote: "가".repeat(501) }).success).toBe(false);
    expect(parse({ metaDescription: "  " }).data?.metaDescription).toBeNull();
    expect(parse({ extra: 1 }).success).toBe(false);
    expect(parse({ status: "published" }).success).toBe(false);
    expect(CHANNEL_DRAFT_LIMITS.metaDescriptionRecommended).toBe(160);
  });
});

describe("화면 상태·오류 문구", () => {
  it("보관 > 게시 기록됨 > 저장 상태", () => {
    expect(channelDraftDisplayStatus({ archived: true, hasActivePublication: true, status: "reviewed" })).toBe("archived");
    expect(channelDraftDisplayStatus({ archived: false, hasActivePublication: true, status: "drafting" })).toBe("published");
    expect(channelDraftDisplayStatus({ archived: false, hasActivePublication: false, status: "reviewed" })).toBe("reviewed");
  });
  it("DB 오류 → 한국어 문구", () => {
    expect(channelDraftErrorFromDb("INVALID_TRANSITION: 준비 완료 브리프로만 초안을 만들 수 있습니다")).toEqual({
      code: "INVALID_TRANSITION",
      message: "준비 완료 브리프로만 초안을 만들 수 있습니다",
    });
    expect(channelDraftErrorFromDb("NOT_FOUND: 초안을 찾을 수 없습니다").code).toBe("NOT_FOUND");
    expect(channelDraftErrorFromDb("관계 없는 오류").code).toBe("ERROR");
  });
  it("파일 이름에 숫자가 그대로 남는다", () => {
    expect(exportFileName("2028년 0289 계획", "html")).toBe("2028년 0289 계획.html");
  });
});
