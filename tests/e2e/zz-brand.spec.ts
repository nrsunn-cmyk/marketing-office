import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginWithWorkspace, mailGap, OWNER } from "./helpers";
import { deleteMessagesTo, waitForMail } from "./mailpit";

/**
 * AGY 브랜드 에셋 적용: 탭 아이콘·아이폰 아이콘·링크 미리보기 그림·머리글/로그인 심볼·로그인 메일.
 */

test("탭 아이콘·홈 화면 아이콘·링크 미리보기 그림이 걸려 있고, 로그인 없이 받을 수 있다", async ({ page, request }) => {
  await page.goto("/login");
  const head = page.locator("head");
  const icon = await head.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
  const apple = await head.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  const og = await head.locator('meta[property="og:image"]').getAttribute("content");
  const imageURL = new URL(og!);
  const siteURL = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  // Next.js 개발 모드는 파일 기반 이미지를 localhost로 정규화한다. 같은 로컬 서버의 호스트 별칭만 허용한다.
  const loopback = (host: string) => host === "localhost" || host === "127.0.0.1";
  if (loopback(imageURL.hostname) && loopback(siteURL.hostname)) {
    expect(imageURL.protocol).toBe(siteURL.protocol);
    expect(imageURL.port).toBe(siteURL.port);
  } else {
    expect(imageURL.origin).toBe(siteURL.origin);
  }
  await expect(head.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(head.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(head.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  for (const [url, type] of [
    [icon, "image/svg+xml"],
    [apple, "image/png"],
    [og, "image/png"],
    ["/brand/logo-symbol.svg", "image/svg+xml"],
    ["/brand/logo-horizontal.svg", "image/svg+xml"],
    ["/brand/logo-horizontal-dark.svg", "image/svg+xml"],
  ] as const) {
    expect(url, type).toBeTruthy();
    const r = await request.get(url!, { maxRedirects: 0 });
    expect(r.status(), url!).toBe(200);
    expect(r.headers()["content-type"], url!).toContain(type);
  }
});

test("인증 화면 머리글은 테마별 로고 하나만 보이고, 로그인 뒤 머리글에 심볼, 밝은·어두운 화면 모두 접근성 위반이 없다", async ({
  page,
}) => {
  // 로그인 2안(DESIGN-LOGIN-2-FINAL-01, 09c7e6e): 1안의 슬레이트 엠블럼은 없고, 글래스 머리글에 테마별 로고(밝은/어두운)와 '메인 화면으로' 링크
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/login");
    const brand = page
      .getByRole("banner")
      .getByRole("link", { name: "마케팅 업무실" });
    const shown = await brand
      .locator("img")
      .evaluateAll((imgs) =>
        imgs
          .filter(
            (i) =>
              getComputedStyle(i).display !== "none" &&
              (i as HTMLImageElement).naturalWidth > 0,
          )
          .map((i) => i.getAttribute("src")),
      );
    expect(shown, scheme).toEqual([
      scheme === "dark"
        ? "/brand/logo-horizontal-dark.svg"
        : "/brand/logo-horizontal.svg",
    ]);
    await expect(
      page.getByRole("banner").getByRole("link", { name: "메인 화면으로" }),
    ).toHaveAttribute("href", "/");
  }
  await page.emulateMedia({ colorScheme: "light" });
  await loginWithWorkspace(page);
  const brand = page
    .getByRole("banner")
    .getByRole("link", { name: "마케팅 업무실" });
  await expect(brand).toBeVisible();
  await expect(brand.locator("img")).toBeVisible();
  expect(
    await brand
      .locator("img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      r.violations.map((v) => v.id),
      scheme,
    ).toEqual([]);
  }
});

test("계정 메일(비밀번호 재설정)은 AGY 디자인이고, 유효 시간은 실제 설정(1시간)과 같다", async ({ page }) => {
  await deleteMessagesTo([OWNER]);
  // 메일 발송 간격(1초 제한)을 지킨다. 재설정 메일을 받기만 하고 링크는 열지 않으므로 비밀번호는 그대로다.
  await mailGap(OWNER);
  await page.goto("/forgot-password");
  await page.getByLabel("이메일").fill(OWNER);
  await page.getByRole("button", { name: "재설정 링크 받기" }).click();
  await expect(page.getByRole("status").filter({ hasText: "재설정 메일을 보냈습니다" })).toBeVisible(); // 공용 성공 안내 영역(role=status)이 늘 있어 범위 없이 찾으면 두 곳에 걸린다 → 기대 문구로 좁힌다(BUNDLE-C-R1)
  const { subject, html } = await waitForMail(OWNER);
  expect(subject).toBe("[마케팅 업무실] 비밀번호 재설정");
  expect(html).toContain("새 비밀번호 정하기");
  expect(html).toContain("1시간 동안");
  expect(html).not.toContain("15분");
  expect(html).not.toContain("{{");
  expect(html.match(/\/auth\/callback\?token_hash=/g)?.length).toBe(3); // 버튼 링크 + 아래 주소 링크 + 그 주소 글자
});

test("AUTH-UI-01 OS가 밝은·어두운 모드 어느 쪽이어도 인증 화면의 링크·탭은 그 화면 배경과 대비를 지킨다", async ({ browser }) => {
  // 처음(AUTH-UI-01)은 '밝게 고정한 화면에 다크 색 #38bdf8 이 섞이는' 회귀였다. 로그인 2안(DESIGN-LOGIN-2-FINAL-01)은 어두운 모드를 정식으로 지원하고
  // 다크 카드(#131b2e) 위 #38bdf8 은 의도(AGY 확인, QA-BRAND-SPEC-ALIGN-01). 그래서 색 값 금지 대신
  // ① 화면이 OS 모드를 따라 실제로 밝게/어둡게 그려지는지 ② 링크·탭 글자색이 가장 가까운 불투명 배경과 4.5:1 이상인지 본다.
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ channel: "chrome", colorScheme: scheme, viewport: { width: 390, height: 844 } } as never);
    const page = await ctx.newPage();
    for (const [path, names] of [
      ["/login", ["비밀번호 찾기", "로그인", "회원가입"]], // SITE-FIX-01: 물음표 뺀 확정 문구
      ["/forgot-password", ["로그인 화면으로 돌아가기"]], // 2안: 화살표 제거
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const contrast = (el: Element) => {
        // color-mix 로 만든 색은 'color(srgb 0.64 0.69 0.76)'(0~1)로 나온다 → 0~255 로 맞춘다
        const rgb = (c: string) => {
          const n = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
          return c.startsWith("color(srgb") ? n.map((v) => v * 255) : n;
        };
        const lum = (c: number[]) => {
          const [r, g, b] = c.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        let bgEl: Element | null = el;
        let bg = "rgba(0, 0, 0, 0)";
        while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
          bg = getComputedStyle(bgEl).backgroundColor;
          bgEl = bgEl.parentElement;
        }
        const a = lum(rgb(getComputedStyle(el).color));
        const b = lum(rgb(bg));
        return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), bgLum: b };
      };
      const card = await page.locator("main form").first().evaluate(contrast);
      if (scheme === "dark") expect(card.bgLum, `${path} 어두운 카드 배경`).toBeLessThan(0.2);
      else expect(card.bgLum, `${path} 밝은 카드 배경`).toBeGreaterThan(0.7);
      for (const name of names) {
        const link = page.getByRole("link", { name, exact: true });
        await expect(link, `${scheme} ${path} ${name}`).toBeVisible();
        const { ratio } = await link.evaluate(contrast);
        expect(ratio, `${scheme} ${path} ${name} 대비`).toBeGreaterThanOrEqual(4.5);
      }
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${scheme} ${path}`).toEqual([]);
    }
    await ctx.close();
  }
});
