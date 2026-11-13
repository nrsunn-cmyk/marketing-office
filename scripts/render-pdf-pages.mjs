/**
 * PDF 쪽을 PNG 그림으로 바꿔 눈으로 확인하는 개발 도구 (검수용).
 * 사용: node scripts/render-pdf-pages.mjs <pdf 경로> <출력 접두어> <쪽 번호들, 예: 1,2>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderPageAsImage } from "unpdf";
const [,, pdfPath, outPrefix, pagesArg] = process.argv;
const buf = new Uint8Array(readFileSync(pdfPath));
for (const p of pagesArg.split(",").map(Number)) {
  const img = await renderPageAsImage(buf.slice(), p, { canvasImport: () => import("@napi-rs/canvas"), scale: 1.3 });
  writeFileSync(`${outPrefix}-p${p}.png`, Buffer.from(img));
  console.log("wrote", `${outPrefix}-p${p}.png`);
}
