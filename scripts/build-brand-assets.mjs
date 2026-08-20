/**
 * 从 培新图标/ 下的原始 JPG 生成 public/brand/ 下的透明 PNG 品牌资产。
 * 像素级去白底，不重绘。日常开发不需要安装 sharp；只有换 logo 重跑时才用。
 *
 * 运行前：npm i -D sharp
 * 运行：  node scripts/build-brand-assets.mjs
 * 跑完后：npm uninstall sharp
 *
 * 输入：
 *   培新图标/微信图片_20260819171241.jpg   方形图形徽标
 *   培新图标/微信图片_20260819171221.jpg   横版组合标志
 *
 * 输出（全部 PNG-32）：
 *   public/brand/peixin-mark.png         512×512
 *   public/brand/peixin-mark@128.png     128×128
 *   public/brand/peixin-favicon.png       32×32
 *   public/brand/peixin-wordmark.png      高度 200
 *   public/brand/peixin-lockup.png        宽度 1440
 *   public/brand/peixin-lockup@720.png    宽度 720
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INPUT_MARK = path.join(ROOT, "培新图标", "微信图片_20260819171241.jpg");
const INPUT_LOCKUP = path.join(ROOT, "培新图标", "微信图片_20260819171221.jpg");
const OUT_DIR = path.join(ROOT, "public", "brand");

const BRAND_RED = [0xe3, 0x1e, 0x24];
const BRAND_BLACK = [0x11, 0x11, 0x11];
const BRAND_GRAY = [0xbd, 0xbd, 0xbd];
const SNAP_TARGETS = [BRAND_RED, BRAND_BLACK, BRAND_GRAY];

/**
 * 反预乘后到品牌色的欧氏距离上限。只去 JPEG 色噪，不把原图里实际偏暗的红
 * 强行改成 #E31E24（本套 JPEG 实心红约 #D61917，反预乘后约 #D20200，距离 ~49）。
 */
const SNAP_TOLERANCE = 26;

/**
 * JPEG 白底几乎全是 (254,254,254)，按公式会得到 alpha=1 的薄雾；
 * 圆环外侧还有 alpha 2–7 的压缩振铃。alpha ≤ 此值视为背景打掉。
 * 真正的抗锯齿大约从 alpha≈10 开始，不会被吃掉。
 */
const HAZE_FLOOR = 8;

const BBOX_ALPHA = 12;
const MARK_PAD_RATIO = 0.08;
const LOCKUP_PAD_RATIO = 0.04;
const WORDMARK_PAD_OF_GLYPH_HEIGHT = 0.06;

function clamp8(n) {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function colorDist(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.hypot(dr, dg, db);
}

/**
 * 白底转透明 + 反预乘，再做颜色吸附。
 * alpha = 255 - min(R,G,B)
 * R' = 255 - (255-R)*255/alpha   （G/B 同理）
 */
function unwhiteRgb(rgb, width, height) {
  const n = width * height;
  const out = Buffer.alloc(n * 4);
  let hazeKilled = 0;
  let snapped = 0;

  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const di = i * 4;
    let alpha = 255 - Math.min(r, g, b);

    if (alpha <= HAZE_FLOOR) {
      out[di] = 0;
      out[di + 1] = 0;
      out[di + 2] = 0;
      out[di + 3] = 0;
      if (alpha > 0) hazeKilled += 1;
      continue;
    }

    const r2 = clamp8(Math.round(255 - ((255 - r) * 255) / alpha));
    const g2 = clamp8(Math.round(255 - ((255 - g) * 255) / alpha));
    const b2 = clamp8(Math.round(255 - ((255 - b) * 255) / alpha));

    let sr = r2;
    let sg = g2;
    let sb = b2;
    let bestD = SNAP_TOLERANCE;
    for (const target of SNAP_TARGETS) {
      const d = colorDist([r2, g2, b2], target);
      if (d < bestD) {
        bestD = d;
        sr = target[0];
        sg = target[1];
        sb = target[2];
      }
    }
    if (sr !== r2 || sg !== g2 || sb !== b2) snapped += 1;

    out[di] = sr;
    out[di + 1] = sg;
    out[di + 2] = sb;
    out[di + 3] = alpha;
  }

  return { data: out, width, height, hazeKilled, snapped };
}

function bboxFromAlpha(data, width, height, minAlpha = BBOX_ALPHA, clip) {
  const xMin = clip?.x0 ?? 0;
  const yMin = clip?.y0 ?? 0;
  const xMax = clip?.x1 ?? width - 1;
  const yMax = clip?.y1 ?? height - 1;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      if (data[(y * width + x) * 4 + 3] >= minAlpha) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    throw new Error(clip ? "指定区域内没有不透明像素" : "未找到不透明像素，无法计算包围盒");
  }
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function crop(data, width, height, box) {
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const src = ((box.y0 + y) * width + box.x0) * 4;
    data.copy(out, y * box.width * 4, src, src + box.width * 4);
  }
  return { data: out, width: box.width, height: box.height };
}

function premultiply(data) {
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    out[i] = Math.round((data[i] * a) / 255);
    out[i + 1] = Math.round((data[i + 1] * a) / 255);
    out[i + 2] = Math.round((data[i + 2] * a) / 255);
    out[i + 3] = a;
  }
  return out;
}

function unpremultiply(data) {
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }
    out[i] = clamp8(Math.round((data[i] * 255) / a));
    out[i + 1] = clamp8(Math.round((data[i + 1] * 255) / a));
    out[i + 2] = clamp8(Math.round((data[i + 2] * 255) / a));
    out[i + 3] = a;
  }
  return out;
}

async function resizeRgba(data, width, height, nextW, nextH) {
  if (width === nextW && height === nextH) {
    return { data: Buffer.from(data), width, height };
  }
  const resized = await sharp(premultiply(data), {
    raw: { width, height, channels: 4 },
  })
    .resize(nextW, nextH, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: unpremultiply(resized.data),
    width: resized.info.width,
    height: resized.info.height,
  };
}

function pasteCentered(src, srcW, srcH, canvasW, canvasH) {
  const out = Buffer.alloc(canvasW * canvasH * 4);
  const dx = Math.round((canvasW - srcW) / 2);
  const dy = Math.round((canvasH - srcH) / 2);
  for (let y = 0; y < srcH; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= canvasH) continue;
    for (let x = 0; x < srcW; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= canvasW) continue;
      const si = (y * srcW + x) * 4;
      const ti = (ty * canvasW + tx) * 4;
      out[ti] = src[si];
      out[ti + 1] = src[si + 1];
      out[ti + 2] = src[si + 2];
      out[ti + 3] = src[si + 3];
    }
  }
  return out;
}

function padAround(src, srcW, srcH, padX, padY) {
  const canvasW = srcW + padX * 2;
  const canvasH = srcH + padY * 2;
  return {
    data: pasteCentered(src, srcW, srcH, canvasW, canvasH),
    width: canvasW,
    height: canvasH,
  };
}

/**
 * 把主体放进带比例边距的画布。边距按画布边长计，主体等比缩放不变形。
 */
async function fitWithCanvasPadding(src, srcW, srcH, canvasW, canvasH, padRatio) {
  const innerW = Math.max(1, Math.round(canvasW * (1 - 2 * padRatio)));
  const innerH = Math.max(1, Math.round(canvasH * (1 - 2 * padRatio)));
  const scale = Math.min(innerW / srcW, innerH / srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));
  const resized = await resizeRgba(src, srcW, srcH, dw, dh);
  return {
    data: pasteCentered(resized.data, resized.width, resized.height, canvasW, canvasH),
    width: canvasW,
    height: canvasH,
  };
}

function columnInk(data, width, height, minAlpha = BBOX_ALPHA) {
  const ink = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * 4 + 3] >= minAlpha) n += 1;
    }
    ink[x] = n;
  }
  return ink;
}

function rowInkRange(data, width, height, x0, x1, minAlpha = BBOX_ALPHA) {
  const ink = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = x0; x <= x1; x++) {
      if (data[(y * width + x) * 4 + 3] >= minAlpha) n += 1;
    }
    ink[y] = n;
  }
  return ink;
}

function runsFrom(values, minValue) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const on = i < values.length && values[i] >= minValue;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const slice = values.slice(start, i);
      runs.push({
        start,
        end: i - 1,
        length: i - start,
        peak: Math.max(...slice),
      });
      start = -1;
    }
  }
  return runs;
}

function findDivider(data, width, height) {
  const ink = columnInk(data, width, height);
  const x0 = Math.floor(width * 0.22);
  const x1 = Math.floor(width * 0.55);
  let best = null;
  for (let x = x0; x <= x1; x++) {
    if (ink[x] < height * 0.35) continue;
    let left = x;
    let right = x;
    while (left > x0 && ink[left - 1] > height * 0.12) left -= 1;
    while (right < x1 && ink[right + 1] > height * 0.12) right += 1;
    const span = right - left + 1;
    const peak = Math.max(...ink.slice(left, right + 1));
    if (span <= 14 && (!best || peak > best.peak)) {
      best = { x0: left, x1: right, peak, span };
    }
    x = right;
  }
  if (!best) {
    throw new Error("未找到横版标志中的竖分隔线");
  }
  return best;
}

function findWordmarkBox(data, width, height, divider) {
  const xStart = divider.x1 + 12;
  const ink = rowInkRange(data, width, height, xStart, width - 1);
  const runs = runsFrom(ink, 8).filter((run) => run.length >= 20);
  if (runs.length === 0) {
    throw new Error("分隔线右侧没有找到字形");
  }
  const chinese = runs[0];
  return bboxFromAlpha(
    data,
    width,
    height,
    BBOX_ALPHA,
    { x0: xStart, y0: chinese.start, x1: width - 1, y1: chinese.end },
  );
}

async function encodePng(data, width, height, filePath, { palette = false } = {}) {
  const options = {
    compressionLevel: 9,
    adaptiveFiltering: true,
  };
  if (palette) {
    options.palette = true;
    options.dither = 0;
    options.effort = 10;
    options.colours = 256;
    options.quality = 100;
  }
  await sharp(data, { raw: { width, height, channels: 4 } })
    .png(options)
    .toFile(filePath);
}

async function fileKb(filePath) {
  const st = await fs.stat(filePath);
  return { bytes: st.size, kb: +(st.size / 1024).toFixed(1) };
}

function alphaHistogram(data) {
  const hist = new Array(256).fill(0);
  for (let i = 3; i < data.length; i += 4) hist[data[i]] += 1;
  return hist;
}

/**
 * 叠在 #1A1A1A 上检查半透明边缘是否出现浅灰/白描边。
 * 这是像素统计，不是视觉渲染验收。
 */
function inspectDarkFringe(data, width, height) {
  const bg = 0x1a;
  let fringe = 0;
  let edgePixels = 0;
  let maxGray = 0;
  const examples = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= HAZE_FLOOR || a >= 250) continue;
    edgePixels += 1;
    const r = Math.round((data[i] * a) / 255 + (bg * (255 - a)) / 255);
    const g = Math.round((data[i + 1] * a) / 255 + (bg * (255 - a)) / 255);
    const b = Math.round((data[i + 2] * a) / 255 + (bg * (255 - a)) / 255);
    const mn = Math.min(r, g, b);
    const sat = Math.max(r, g, b) - mn;
    if (mn > maxGray && sat < 28) maxGray = mn;
    if (mn >= bg + 28 && sat < 24) {
      fringe += 1;
      if (examples.length < 6) {
        const p = i / 4;
        examples.push({
          x: p % width,
          y: Math.floor(p / width),
          a,
          src: [data[i], data[i + 1], data[i + 2]],
          overDark: [r, g, b],
        });
      }
    }
  }
  return { edgePixels, fringe, maxGray, examples };
}

function sampleSolidFills(data, width, height) {
  let redN = 0;
  let red = [0, 0, 0];
  let blackN = 0;
  let black = [0, 0, 0];
  let redA = 0;
  let blackA = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (a >= 210 && r > 140 && g < 50 && b < 50) {
      redN += 1;
      red[0] += r;
      red[1] += g;
      red[2] += b;
      redA += a;
    }
    if (a >= 210 && r < 40 && g < 40 && b < 40) {
      blackN += 1;
      black[0] += r;
      black[1] += g;
      black[2] += b;
      blackA += a;
    }
  }
  return {
    red: redN
      ? {
          n: redN,
          rgb: red.map((v) => Math.round(v / redN)),
          alpha: Math.round(redA / redN),
        }
      : null,
    black: blackN
      ? {
          n: blackN,
          rgb: black.map((v) => Math.round(v / blackN)),
          alpha: Math.round(blackA / blackN),
        }
      : null,
  };
}

async function loadJpegRgb(filePath) {
  const { data, info } = await sharp(filePath).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  return { data, width: info.width, height: info.height };
}

async function writeAsset(name, img) {
  const filePath = path.join(OUT_DIR, name);
  await encodePng(img.data, img.width, img.height, filePath, { palette: false });
  let stat = await fileKb(filePath);
  let palette = false;

  const sizeCap =
    name === "peixin-mark.png" ? 80 * 1024 : name === "peixin-lockup.png" ? 150 * 1024 : null;

  if (sizeCap && stat.bytes > sizeCap) {
    const trial = filePath + ".palette-trial.png";
    await encodePng(img.data, img.width, img.height, trial, { palette: true });
    const trialStat = await fileKb(trial);
    const original = await sharp(filePath).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    const quantized = await sharp(trial).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    let maxDiff = 0;
    let changed = 0;
    const n = original.info.width * original.info.height;
    for (let i = 0; i < n; i++) {
      const a0 = original.data[i * 4 + 3];
      const a1 = quantized.data[i * 4 + 3];
      if (a0 === 0 && a1 === 0) continue;
      const d = Math.max(
        Math.abs(original.data[i * 4] - quantized.data[i * 4]),
        Math.abs(original.data[i * 4 + 1] - quantized.data[i * 4 + 1]),
        Math.abs(original.data[i * 4 + 2] - quantized.data[i * 4 + 2]),
        Math.abs(a0 - a1),
      );
      if (d > 0) changed += 1;
      if (d > maxDiff) maxDiff = d;
    }
    await fs.unlink(trial);
    if (trialStat.bytes <= sizeCap && maxDiff <= 4) {
      await encodePng(img.data, img.width, img.height, filePath, { palette: true });
      stat = await fileKb(filePath);
      palette = true;
    }
    return { filePath, ...stat, palette, maxDiff, sizeCap, overBudget: stat.bytes > sizeCap };
  }

  return { filePath, ...stat, palette, sizeCap, overBudget: sizeCap ? stat.bytes > sizeCap : false };
}

function logImage(label, img, extra = {}) {
  const hist = alphaHistogram(img.data);
  const opaque = hist.slice(250).reduce((a, b) => a + b, 0);
  const clear = hist[0];
  const fringe = inspectDarkFringe(img.data, img.width, img.height);
  const fills = sampleSolidFills(img.data, img.width, img.height);
  console.log(`\n[${label}] ${img.width}×${img.height}`);
  console.log(`  全透明 ${clear}  近不透明(a>=250) ${opaque}  半透明 ${img.width * img.height - clear - opaque}`);
  console.log(`  深色底边缘：半透明像素 ${fringe.edgePixels}，疑似浅灰白边 ${fringe.fringe}，半透明区最大低饱和明度 ${fringe.maxGray}`);
  if (fringe.examples.length) console.log("  白边样例", fringe.examples);
  if (fills.red) console.log(`  实心红均值 RGB(${fills.red.rgb.join(",")}) alpha=${fills.red.alpha} n=${fills.red.n}`);
  if (fills.black) console.log(`  实心黑均值 RGB(${fills.black.rgb.join(",")}) alpha=${fills.black.alpha} n=${fills.black.n}`);
  for (const [k, v] of Object.entries(extra)) console.log(`  ${k}: ${v}`);
  return fringe;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log("读取原图…");
  const markRgb = await loadJpegRgb(INPUT_MARK);
  const lockupRgb = await loadJpegRgb(INPUT_LOCKUP);
  console.log(`  徽标 JPEG  ${markRgb.width}×${markRgb.height}`);
  console.log(`  横版 JPEG  ${lockupRgb.width}×${lockupRgb.height}`);

  const markRgba = unwhiteRgb(markRgb.data, markRgb.width, markRgb.height);
  const lockupRgba = unwhiteRgb(lockupRgb.data, lockupRgb.width, lockupRgb.height);
  console.log(`  徽标去雾 ${markRgba.hazeKilled} px，吸附 ${markRgba.snapped} px`);
  console.log(`  横版去雾 ${lockupRgba.hazeKilled} px，吸附 ${lockupRgba.snapped} px`);

  const markBox = bboxFromAlpha(markRgba.data, markRgba.width, markRgba.height);
  const markCrop = crop(markRgba.data, markRgba.width, markRgba.height, markBox);
  console.log(`  徽标主体包围盒 (${markBox.x0},${markBox.y0})–(${markBox.x1},${markBox.y1}) ${markBox.width}×${markBox.height}`);

  const workSide = Math.max(1, Math.round(Math.max(markCrop.width, markCrop.height) / (1 - 2 * MARK_PAD_RATIO)));
  const markWork = await fitWithCanvasPadding(
    markCrop.data,
    markCrop.width,
    markCrop.height,
    workSide,
    workSide,
    MARK_PAD_RATIO,
  );
  logImage("徽标工作画布", markWork, { 边距: `${MARK_PAD_RATIO * 100}%`, 边长: workSide });

  const mark512 = await resizeRgba(markWork.data, markWork.width, markWork.height, 512, 512);
  const mark128 = await resizeRgba(markWork.data, markWork.width, markWork.height, 128, 128);
  const mark32 = await resizeRgba(markWork.data, markWork.width, markWork.height, 32, 32);

  const lockupBox = bboxFromAlpha(lockupRgba.data, lockupRgba.width, lockupRgba.height);
  const lockupCrop = crop(lockupRgba.data, lockupRgba.width, lockupRgba.height, lockupBox);
  console.log(`  横版主体包围盒 (${lockupBox.x0},${lockupBox.y0})–(${lockupBox.x1},${lockupBox.y1}) ${lockupBox.width}×${lockupBox.height}`);

  const lockupWorkW = Math.max(1, Math.round(lockupCrop.width / (1 - 2 * LOCKUP_PAD_RATIO)));
  const lockupWorkH = Math.max(1, Math.round(lockupCrop.height / (1 - 2 * LOCKUP_PAD_RATIO)));
  const lockupWork = await fitWithCanvasPadding(
    lockupCrop.data,
    lockupCrop.width,
    lockupCrop.height,
    lockupWorkW,
    lockupWorkH,
    LOCKUP_PAD_RATIO,
  );

  const lockup1440H = Math.max(1, Math.round((lockupWork.height * 1440) / lockupWork.width));
  const lockup720H = Math.max(1, Math.round((lockupWork.height * 720) / lockupWork.width));
  const lockup1440 = await resizeRgba(lockupWork.data, lockupWork.width, lockupWork.height, 1440, lockup1440H);
  const lockup720 = await resizeRgba(lockupWork.data, lockupWork.width, lockupWork.height, 720, lockup720H);

  const divider = findDivider(lockupRgba.data, lockupRgba.width, lockupRgba.height);
  console.log(`  竖分隔线 x=${divider.x0}–${divider.x1} (${divider.span}px)`);
  const wordBox = findWordmarkBox(lockupRgba.data, lockupRgba.width, lockupRgba.height, divider);
  const wordCrop = crop(lockupRgba.data, lockupRgba.width, lockupRgba.height, wordBox);
  const wordPad = Math.max(1, Math.round(wordCrop.height * WORDMARK_PAD_OF_GLYPH_HEIGHT));
  const wordPadded = padAround(wordCrop.data, wordCrop.width, wordCrop.height, wordPad, wordPad);
  const wordH = 200;
  const wordW = Math.max(1, Math.round((wordPadded.width * wordH) / wordPadded.height));
  const wordmark = await resizeRgba(wordPadded.data, wordPadded.width, wordPadded.height, wordW, wordH);
  console.log(`  中文字标包围盒 (${wordBox.x0},${wordBox.y0})–(${wordBox.x1},${wordBox.y1}) ${wordBox.width}×${wordBox.height}，边距 ${wordPad}px`);

  console.log("\n写出 PNG…");
  const outputs = [];
  outputs.push(["peixin-mark.png", mark512]);
  outputs.push(["peixin-mark@128.png", mark128]);
  outputs.push(["peixin-favicon.png", mark32]);
  outputs.push(["peixin-wordmark.png", wordmark]);
  outputs.push(["peixin-lockup.png", lockup1440]);
  outputs.push(["peixin-lockup@720.png", lockup720]);

  const written = [];
  for (const [name, img] of outputs) {
    logImage(name, img);
    const info = await writeAsset(name, img);
    written.push({ name, width: img.width, height: img.height, ...info });
    console.log(
      `  -> ${name}  ${img.width}×${img.height}  ${info.kb} KB${info.palette ? " (palette)" : ""}${info.overBudget ? "  **超出体积预算**" : ""}`,
    );
  }

  console.log("\n完成。体积预算：peixin-mark.png ≤ 80KB，peixin-lockup.png ≤ 150KB。");
  for (const item of written) {
    if (item.overBudget) {
      console.log(`  未达标：${item.name} ${item.kb} KB`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
