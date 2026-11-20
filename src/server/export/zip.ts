import { crc32, deflateRawSync } from "node:zlib";

/**
 * P3E-BACKEND-IMPL-01: 아주 작은 zip 작성기(새 의존성 0, Master 결정 D1 A안). .pptx 는 zip 안의 XML 묶음이다.
 * - 압축은 node:zlib deflateRaw, 확인값은 node:zlib crc32(Node 26, package.json engines).
 * - 항목 이름은 호출하는 쪽이 정한 ASCII 고정 경로뿐이다(사용자 글이 경로에 들어가지 않는다 → zip slip 없음). 그래도 여기서 한 번 더 막는다.
 * - 시각은 1980-01-01 00:00 고정(같은 내용이면 같은 파일 — 시험·검수에서 비교하기 쉽게). 파일 안 실제 시각은 docProps/core.xml 에 있다.
 * - zip64·암호화·주석은 쓰지 않는다(파일이 수백 KB 라 필요 없음).
 */
export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const SAFE_NAME = /^(?:\[Content_Types\]\.xml|[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*\/?[A-Za-z0-9_.]*\.(?:xml|rels))$/;

export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const e of entries) {
    if (!SAFE_NAME.test(e.name) || e.name.includes("..") || seen.has(e.name)) throw new Error(`zip 항목 이름이 올바르지 않습니다: ${e.name}`);
    seen.add(e.name);
    const name = enc.encode(e.name);
    const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const comp = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw) >>> 0;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 풀 때 필요한 판
    lv.setUint16(6, 0, true); // 플래그
    lv.setUint16(8, 8, true); // deflate
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // 만든 판
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // 내부 속성
    cv.setUint32(38, 0, true); // 외부 속성
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, comp);
    centrals.push(central);
    offset += local.length + comp.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  const out = new Uint8Array(offset + cdSize + end.length);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
