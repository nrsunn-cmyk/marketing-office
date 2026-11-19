import { describe, expect, it } from "vitest";
import { withDownloadName } from "./download-name";

describe("withDownloadName", () => {
  it("download 값을 한 번만 인코딩해 붙이고 서명 토큰은 그대로 둔다", () => {
    const u = withDownloadName("http://127.0.0.1:1/storage/v1/object/sign/design-assets/w/x.svg?token=abc.def&download=", "로고 v2.svg");
    expect(u).toBe("http://127.0.0.1:1/storage/v1/object/sign/design-assets/w/x.svg?token=abc.def&download=%EB%A1%9C%EA%B3%A0%20v2.svg");
    expect(withDownloadName("http://h/a?token=t", "a&b=c.png")).toBe("http://h/a?token=t&download=a%26b%3Dc.png");
  });
});
