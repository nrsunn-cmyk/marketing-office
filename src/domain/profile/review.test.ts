import { describe, expect, it } from "vitest";
import { lastDecisions, profileDiff, profileHashInput, profileStatusOf, type ProfileDecision, type ProfileFields } from "./review";

/** P2-PROFILE-APP-01: 프로필 버전 검토 순수 함수. 합성 값만 쓴다 */
const v = (o: Partial<ProfileFields> = {}): ProfileFields => ({
  id: "00000000-0000-4000-8000-00000000b001",
  version: 1,
  products: "원두",
  audience: "직장인",
  strengths: ["핸드드립", "역 앞"],
  brand_rules: null,
  channel_urls: ["https://example.com/a"],
  ...o,
});

describe("profileDiff", () => {
  it("바뀐 글 항목은 이전·지금, 목록은 더함·뺌으로", () => {
    const changes = profileDiff(v(), v({ version: 2, products: "원두·디저트", strengths: ["핸드드립", "주차 가능"], channel_urls: ["https://example.com/a"] }));
    expect(changes).toEqual([
      { key: "products", label: "상품·서비스", kind: "text", before: "원두", after: "원두·디저트" },
      { key: "strengths", label: "강점", kind: "list", added: ["주차 가능"], removed: ["역 앞"] },
    ]);
  });
  it("앞뒤 공백·빈 항목만 다르면 변경 없음", () => {
    expect(profileDiff(v(), v({ version: 2, products: "  원두 ", strengths: ["핸드드립", " 역 앞", ""] }))).toEqual([]);
  });
  it("첫 버전(이전 없음)은 값이 있는 항목을 모두 새로 생김으로", () => {
    expect(profileDiff(null, v()).map((c) => c.key)).toEqual(["products", "audience", "strengths", "channel_urls"]);
  });
  it("HTML 같은 문자열도 그대로 텍스트로 돌려준다(렌더러가 escape)", () => {
    const x = '<img src=x onerror="alert(1)">';
    expect(profileDiff(v(), v({ version: 2, audience: x }))[0]).toMatchObject({ after: x });
  });
});

describe("profileHashInput", () => {
  it("같은 내용이면 같고, id·version·내용 하나라도 다르면 다르다", () => {
    const base = profileHashInput(v());
    expect(profileHashInput(v({ strengths: [" 핸드드립", "역 앞"] }))).toBe(base);
    expect(profileHashInput(v({ version: 2 }))).not.toBe(base);
    expect(profileHashInput(v({ id: "00000000-0000-4000-8000-00000000b002" }))).not.toBe(base);
    expect(profileHashInput(v({ brand_rules: "반말 금지" }))).not.toBe(base);
  });
});

describe("결정 상태", () => {
  const d = (versionId: string, decision: string, seq: number): ProfileDecision => ({ versionId, decision, seq, createdAt: "2026-11-17T00:00:00Z", actorId: "u" });
  it("버전별 마지막 결정(seq 최대)으로 상태를 정한다", () => {
    const m = lastDecisions([d("a", "approved", 1), d("b", "approved", 2), d("a", "revoked", 3), d("b", "revoked", 1)]);
    expect(profileStatusOf(m.get("a"))).toBe("revoked");
    expect(profileStatusOf(m.get("b"))).toBe("approved");
    expect(profileStatusOf(m.get("c"))).toBe("pending");
  });
});
