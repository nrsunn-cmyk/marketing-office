import { describe, expect, it } from "vitest";
import {
  briefErrorFromDb,
  briefTemplate,
  briefToMarkdown,
  briefUpdateSchema,
  briefWarnings,
  checkBriefCopy,
  parseBriefSpec,
  sourceLinkSchema,
  type BriefCopyRequest,
} from ".";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("채널별 spec 계약(DB app.brief_spec_ok 와 같은 규칙)", () => {
  it("그 채널 키만 통과", () => {
    expect(parseBriefSpec("blog", { titleIdeas: [" 제목 "], keywords: ["키워드"] })).toEqual({ ok: true, data: { titleIdeas: ["제목"], keywords: ["키워드"] } });
    expect(parseBriefSpec("instagram", { format: "reel", hashtags: ["합성"] }).ok).toBe(true);
    expect(parseBriefSpec("linkedin", { format: "reel" }).ok).toBe(false);
    expect(parseBriefSpec("blog", { score: 1 }).ok).toBe(false);
  });
  it("개수·길이·빈 줄은 한국어 안내", () => {
    expect(parseBriefSpec("ad_copy", { headlines: Array(6).fill("헤드") })).toEqual({ ok: false, message: "헤드라인은(는) 5개까지입니다." });
    expect(parseBriefSpec("ad_copy", { headlines: ["가".repeat(61)] })).toEqual({ ok: false, message: "헤드라인은(는) 60자 이하여야 합니다." });
    expect(parseBriefSpec("newsletter", { outline: ["  "] })).toEqual({ ok: false, message: "아웃라인이(가) 비어 있습니다." });
    expect(parseBriefSpec("instagram", { format: "story" })).toEqual({ ok: false, message: "게시 형식을 골라 주세요." });
  });
});

describe("브리프 입력 계약", () => {
  it("공백 정리·빈 값 null·기본값", () => {
    const r = briefUpdateSchema.parse({ title: " 브리프 ", hook: " \n", coreMessage: "  요지 " });
    expect(r).toMatchObject({ title: "브리프", hook: null, coreMessage: "요지", audience: null, copyOrigin: "manual", status: "drafting", channelSpec: {} });
  });
  it("copyOrigin ai 는 아직 없다", () => {
    expect(briefUpdateSchema.safeParse({ title: "x", copyOrigin: "ai" }).success).toBe(false);
  });
  it("근거 연결: 프로필은 항목 필수, 자료는 항목 없음", () => {
    expect(sourceLinkSchema.safeParse({ kind: "profile", targetId: ID1, profileField: "strengths" }).success).toBe(true);
    expect(sourceLinkSchema.safeParse({ kind: "profile", targetId: ID1 }).success).toBe(false);
    expect(sourceLinkSchema.safeParse({ kind: "asset", targetId: ID1, profileField: "strengths" }).success).toBe(false);
    expect(sourceLinkSchema.safeParse({ kind: "url", targetId: ID1 }).success).toBe(false);
  });
});

describe("템플릿 초기값", () => {
  it("문장을 지어내지 않는다: 카드 제목·전략 타깃·제안 첫 문장만", () => {
    const t = briefTemplate("blog", { itemTitle: " 체크리스트 ", basis: { goals: ["목표"], offers: ["무료 진단"], audiences: ["중견기업 CTO"] } });
    expect(t).toEqual({ channel: "blog", title: "체크리스트", audience: "중견기업 CTO", coreMessage: "무료 진단", cta: null, channelSpec: { titleIdeas: ["체크리스트"] } });
    const empty = briefTemplate("ad_copy", { itemTitle: "", basis: { goals: [], offers: [], audiences: [] } });
    expect(empty).toMatchObject({ title: "광고 카피", audience: null, coreMessage: null, channelSpec: {} });
    for (const ch of ["blog", "instagram", "ad_copy", "linkedin", "newsletter"] as const) {
      expect(parseBriefSpec(ch, briefTemplate(ch, { itemTitle: "x", basis: { goals: [], offers: [], audiences: [] } }).channelSpec).ok, ch).toBe(true);
    }
  });
});

describe("경고·복사", () => {
  const claims = [
    { id: ID1, text: "SLA 99.99%", kind: "capability" as const, sources: [{ label: "회사 프로필 v1 · 강점" }] },
    { id: ID2, text: "비용 80% 절감", kind: "statistic" as const, sources: [] },
  ];
  it("빈 브리프, 미확인 주장", () => {
    expect(briefWarnings({ hook: null, coreMessage: null }, [])).toEqual([{ kind: "empty" }]);
    expect(briefWarnings({ hook: "훅", coreMessage: null }, claims)).toEqual([{ kind: "unverified", claimIds: [ID2] }]);
    expect(briefWarnings({ hook: "훅", coreMessage: null }, claims.slice(0, 1))).toEqual([]);
  });
  it("마크다운: 채널·필드·spec·주장(미확인 표시)·카피", () => {
    const md = briefToMarkdown({
      channel: "instagram", title: "브리프", stageLabel: "인지", audience: "CTO", hook: "훅", coreMessage: null, cta: "신청",
      channelSpec: { format: "carousel", hashtags: ["데이터"] }, copyDraft: "카피", imageGuide: null, stale: true,
    }, claims);
    expect(md).toBe([
      "# 브리프", "", "- 채널: 인스타그램", "- 퍼널 단계: 인지", "- ⚠ 이전 전략 기준으로 작성된 브리프입니다",
      "- 타깃 독자: CTO", "- 훅: 훅", "- CTA: 신청", "", "## 채널별 지침", "- 게시 형식: carousel", "- 해시태그:", "  - 데이터",
      "", "## 주장과 근거", "1. SLA 99.99%", "   - 근거: 회사 프로필 v1 · 강점", "2. 비용 80% 절감 [미확인 주장]", "", "## 카피 초안", "", "카피", "",
    ].join("\n"));
  });
  it("DB 오류: SOURCE_MISMATCH 는 설명 그대로, 나머지는 퍼널 규칙", () => {
    expect(briefErrorFromDb("SOURCE_MISMATCH: 이 프로젝트의 자료만 근거로 쓸 수 있습니다")).toEqual({ code: "SOURCE_MISMATCH", message: "이 프로젝트의 자료만 근거로 쓸 수 있습니다" });
    expect(briefErrorFromDb("VALIDATION: 이미 연결한 근거입니다").message).toBe("이미 연결한 근거입니다");
    expect(briefErrorFromDb("boom").code).toBe("ERROR");
  });
});

describe("LLM 계약 검사(호출 없음)", () => {
  const req: BriefCopyRequest = {
    channel: "blog", title: "브리프", audience: null, hook: "지연 30% 줄이기", coreMessage: null, cta: null, channelSpec: {},
    claims: [{ id: ID1, text: "SLA 99.99%", sourceLabels: ["프로필 강점"] }],
    constraints: { language: "ko", maxChars: 100, variants: 2 },
  };
  const ok = { variants: [{ text: "지연을 30% 줄이고 SLA 99.99%를 지킵니다", usedClaimIds: [ID1] }], model: "합성-모델", generatedAt: "2026-11-18T10:00:00Z" };
  it("요청 안의 수치·주장만 쓰면 통과", () => {
    expect(checkBriefCopy(req, ok).ok).toBe(true);
  });
  it("근거 없는 주장 id·새 수치·글자 수·변형 수·형식 거절", () => {
    const bad = checkBriefCopy(req, {
      ...ok,
      variants: [
        { text: "비용 80% 절감", usedClaimIds: [ID2] },
        { text: "가".repeat(101), usedClaimIds: [] },
        { text: "x", usedClaimIds: [] },
      ],
    });
    expect(bad).toEqual({
      ok: false,
      problems: ["요청보다 많은 변형이 왔습니다.", "1번 변형이 근거 없는 주장을 썼습니다.", "1번 변형에 근거 없는 수치가 있습니다: 80%", "2번 변형이 글자 수 제한을 넘었습니다."],
    });
    expect(checkBriefCopy(req, { variants: [] })).toEqual({ ok: false, problems: ["응답 형식이 계약과 다릅니다."] });
  });
});
