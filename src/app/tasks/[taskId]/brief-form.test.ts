import { describe, expect, it } from "vitest";
import { BRIEF_CHANNELS, BRIEF_SPEC_SCHEMAS, briefUpdateSchema, claimInputSchema, parseBriefSpec, sourceLinkSchema, type BriefChannel } from "@/domain/brief";
import { SPEC_FIELDS, formToSpec, specToForm, toBriefPayload, toClaimPayload, toSourcePayload, type BriefFormValue } from "./brief-form";

/** P2F-FRONT-01: 화면 폼이 만드는 값이 서버 계약을 그대로 통과하는지 */
const base: BriefFormValue = {
  title: "  블로그 글 제목  ",
  audience: "",
  hook: "첫 문장",
  coreMessage: "",
  cta: "",
  spec: {},
  copyDraft: "",
  copyOrigin: "template",
  imageGuide: "",
  status: "drafting",
};
const sample: Record<string, string> = {
  titleIdeas: "제목 1\n\n 제목 2 ",
  outline: "1장\n2장",
  keywords: "키워드",
  format: "carousel",
  captionGuide: "  캡션  ",
  hashtags: "태그1\n태그2",
  platform: "네이버 검색광고",
  headlines: "헤드라인",
  descriptions: "설명문",
  subjectLines: "메일 제목",
};

describe("브리프 폼 → 서버 계약", () => {
  it("화면의 채널 항목 키는 서버 계약 키와 같다(5개 채널)", () => {
    for (const ch of Object.keys(BRIEF_CHANNELS) as BriefChannel[]) {
      expect(SPEC_FIELDS[ch].map((f) => f.key).sort()).toEqual(Object.keys(BRIEF_SPEC_SCHEMAS[ch].shape).sort());
    }
  });

  it.each(Object.keys(BRIEF_CHANNELS) as BriefChannel[])("%s: payload 가 briefUpdateSchema·채널 spec 을 통과", (ch) => {
    const spec = Object.fromEntries(SPEC_FIELDS[ch].map((f) => [f.key, sample[f.key]!]));
    const payload = toBriefPayload(ch, { ...base, spec });
    const r = briefUpdateSchema.safeParse(payload);
    expect(r.success).toBe(true);
    expect(r.data?.title).toBe("블로그 글 제목");
    expect(r.data?.audience).toBeNull();
    const s = parseBriefSpec(ch, r.data?.channelSpec);
    expect(s.ok).toBe(true);
  });

  it("빈 줄은 빼고 빈 칸은 보내지 않는다(서버는 빈 줄을 거절)", () => {
    expect(formToSpec("blog", { titleIdeas: "제목 1\n\n 제목 2 ", outline: "\n\n", keywords: "" })).toEqual({ titleIdeas: ["제목 1", "제목 2"] });
    expect(formToSpec("instagram", { format: "", captionGuide: "   ", hashtags: "" })).toEqual({});
  });

  it("저장된 값 → 폼 → 저장 값이 같다", () => {
    const saved = { headlines: ["가", "나"], platform: "매체" };
    expect(formToSpec("ad_copy", specToForm("ad_copy", saved))).toEqual(saved);
  });

  it("주장·근거 payload 가 계약을 통과", () => {
    expect(claimInputSchema.safeParse(toClaimPayload(" 고객 만족도 높음 ", "statistic")).data).toEqual({ text: "고객 만족도 높음", kind: "statistic" });
    const id = "00000000-0000-4000-8000-000000000001";
    expect(sourceLinkSchema.safeParse(toSourcePayload(`profile:${id}:strengths`, "")).data).toEqual({ kind: "profile", targetId: id, profileField: "strengths", note: null });
    expect(sourceLinkSchema.safeParse(toSourcePayload(`asset:${id}`, " 3쪽 ")).data).toEqual({ kind: "asset", targetId: id, note: "3쪽" });
    expect(sourceLinkSchema.safeParse(toSourcePayload(`research:${id}`, "")).success).toBe(true);
  });

  it("다른 채널의 키는 서버가 거절한다(폼은 그 채널 키만 만든다)", () => {
    expect(parseBriefSpec("linkedin", formToSpec("blog", { keywords: "키워드" })).ok).toBe(false);
    expect(Object.keys(formToSpec("linkedin", { ...sample }))).toEqual(["outline", "hashtags"]);
  });
});
