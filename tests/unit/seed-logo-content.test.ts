import { describe, expect, it } from "vitest";
import { logoBriefInputSchema } from "@/contracts";
import { buildLogoBrief } from "@/domain/logo";
import { SEED_LOGO_INPUTS, seedLogoContent } from "../../scripts/seed-logo-content.mts";

/**
 * SEED-01: 검수용 예시 데이터의 로고 결과가 작업 화면(ResultView)에서 그대로 보일 수 있는 모양인지 확인한다.
 * 화면은 version.content 의 missingInformation(.length, .map(m => m.label)), brief, imagePrompt 를 읽고,
 * 입력 폼(logoDefaults)은 content.input 을 다시 쓴다. DB(jsonb)를 거친 뒤의 모양으로 검사한다.
 */
const viaDb = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** ResultView 가 결과 내용에서 읽는 부분을 같은 순서로 흉내 낸다(화면 코드를 바꾸지 않고 구조만 확인). */
function readLikeResultView(c: { missingInformation: Array<{ label: string }>; brief: string; imagePrompt: string }) {
  const notice = c.missingInformation.length > 0 ? c.missingInformation.map((m) => m.label).join(", ") : null;
  return { notice, brief: c.brief, imagePrompt: c.imagePrompt };
}

describe("검수용 예시 데이터 로고 결과", () => {
  it("재현: 예전 시드 모양 { brief, prompts }는 화면이 읽을 때 TypeError로 멈춘다", () => {
    const old = viaDb({ brief: "A 로고 리뉴얼 — 로고 방향 3가지", prompts: ["미니멀 워드마크"] });
    expect(() => readLikeResultView(old as never)).toThrow(TypeError);
  });

  it.each(Object.entries(SEED_LOGO_INPUTS))("%s: 화면이 읽는 값을 모두 갖추고 앱 생성 결과와 같다", (_name, input) => {
    const content = viaDb(seedLogoContent(input));
    const shown = readLikeResultView(content);
    expect(shown.brief.length).toBeGreaterThan(0);
    expect(shown.imagePrompt.length).toBeGreaterThan(0);
    for (const m of content.missingInformation) expect(typeof m.label).toBe("string");

    // 앱의 입력 조합형 생성(buildLogoBrief)과 같은 결과
    const built = buildLogoBrief(input);
    if (!built.ok) throw new Error("예시 입력이 잘못됨");
    expect(content).toEqual(viaDb({ ...built.result, input }));
    // 입력 폼이 다시 쓰는 값은 앱 입력 검증을 통과한다
    expect(logoBriefInputSchema.safeParse(content.input).success).toBe(true);
    expect(content.generator.mode).toBe("template");
  });

  it("'확인이 필요한 정보'가 있는 결과와 없는 결과가 함께 있다(검수 화면에서 두 경우 모두 보이게)", () => {
    const notices = Object.values(SEED_LOGO_INPUTS).map((i) => readLikeResultView(viaDb(seedLogoContent(i))).notice);
    expect(notices).toContain(null);
    expect(notices.filter((n) => n !== null).length).toBeGreaterThan(0);
  });
});
