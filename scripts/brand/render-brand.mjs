// AGY 브랜드 SVG를 PNG로 바꾼다. 카카오톡·슬랙 등 링크 미리보기와 아이폰 홈 화면 아이콘은 SVG를 읽지 못한다.
// 사용: node scripts/brand/render-brand.mjs
// 만드는 파일(커밋함): src/app/opengraph-image.png (1200×630), src/app/apple-icon.png (180×180)
// 원본: scripts/brand/og-image.svg, public/brand/logo-symbol.svg (AGY 원본과 같은 내용, Plan/AGY-Visual-Assets-20261114)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, GlobalFonts, Image } from "@napi-rs/canvas";

const ROOT = process.cwd();
const FONT_DIR = join(ROOT, "node_modules", "pretendard", "dist", "public", "static", "alternative");
for (const w of ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"]) {
  GlobalFonts.registerFromPath(join(FONT_DIR, `Pretendard-${w}.ttf`), "Pretendard");
}

async function render(svgPath, outPath, width, height) {
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  image.src = readFileSync(svgPath);
  await loaded;
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log(`만듦: ${outPath} (${width}×${height})`);
}

await render(join(ROOT, "scripts/brand/og-image.svg"), join(ROOT, "src/app/opengraph-image.png"), 1200, 630);
await render(join(ROOT, "public/brand/logo-symbol.svg"), join(ROOT, "src/app/apple-icon.png"), 180, 180);
