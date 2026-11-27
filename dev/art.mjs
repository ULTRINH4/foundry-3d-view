/**
 * Procedural art for the dev pages (map, tokens, tiles, upper level), so the repo has no images.
 */
import { wallRegions, getHeight } from "../scripts/core/heights.mjs";


export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Paint a dungeon map: rock outside the walls, flagstones inside, a rug on the dais. */
export function drawDungeon(m) {
  const g = m.grid;
  const px = 64; // texture pixels per square
  const cv = document.createElement("canvas");
  cv.width = g.cols * px;
  cv.height = g.rows * px;
  const ctx = cv.getContext("2d");
  const rand = rng(7);
  const { labels, regions } = wallRegions(m.walls, g);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const outside = regions[labels[r * g.cols + c]].touchesBorder;
      const h = getHeight(m.heights, c, r);
      const x = c * px, y = r * px;
      if (outside) {
        ctx.fillStyle = `hsl(25, 8%, ${18 + rand() * 6}%)`;
        ctx.fillRect(x, y, px, px);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = `hsla(30, 10%, ${10 + rand() * 25}%, 0.7)`;
          ctx.beginPath();
          ctx.arc(x + rand() * px, y + rand() * px, 3 + rand() * 8, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      ctx.fillStyle = "#3a352f"; // mortar between flagstones
      ctx.fillRect(x, y, px, px);
      const dais = h >= 5 && h < 10;
      const stair = h > 0 && h < 5;
      // two flagstones per square
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const l = (dais ? 34 : stair ? 46 : 52) + rand() * 10;
          ctx.fillStyle = dais ? `hsl(355, 45%, ${l - 10}%)` : `hsl(35, 12%, ${l}%)`;
          ctx.fillRect(x + i * px / 2 + 1, y + j * px / 2 + 1, px / 2 - 2, px / 2 - 2);
        }
      }
      if (stair) {
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(x + (k * px) / 4, y);
          ctx.lineTo(x + (k * px) / 4, y + px);
          ctx.stroke();
        }
      }
    }
  }
  // dark wall lines like a VTT battlemap
  ctx.strokeStyle = "#0b0b0b";
  ctx.lineWidth = 6;
  const s = px / g.size;
  for (const w of m.walls) {
    if ((w.levelIndex ?? 0) > 0) continue;
    ctx.beginPath();
    ctx.moveTo((w.c[0] - g.sceneX) * s, (w.c[1] - g.sceneY) * s);
    ctx.lineTo((w.c[2] - g.sceneX) * s, (w.c[3] - g.sceneY) * s);
    ctx.stroke();
  }
  return cv;
}

/** Token art: a round portrait-like disc with a coloured rim and an initial. */
export function drawToken(tok) {
  const palette = { hero: "#2e86c1", mage: "#8e44ad", boss: "#7b241c", goblin: "#1e8449", ghost: "#566573", archer: "#b9770e" };
  const key = String(tok.src).replace("gen:", "");
  const color = palette[key] ?? "#888";
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 320;
  const ctx = cv.getContext("2d");
  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(48, 310);
  ctx.quadraticCurveTo(128, 40, 208, 310);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.fillStyle = "#f0d0a8";
  ctx.beginPath();
  ctx.arc(128, 110, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tok.name[0], 128, 116);
  // outline for readability
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.moveTo(48, 310);
  ctx.quadraticCurveTo(128, 40, 208, 310);
  ctx.closePath();
  ctx.stroke();
  return cv;
}

/** Upper level: transparent everywhere except a wooden balcony over the east of room B. */
export function drawBalcony(m) {
  const g = m.grid;
  const px = 64;
  const cv = document.createElement("canvas");
  cv.width = g.cols * px;
  cv.height = g.rows * px;
  const ctx = cv.getContext("2d");
  const rand = rng(11);
  const x0 = 18 * px, y0 = 8 * px, w = 4 * px, h = 5 * px;
  for (let i = 0; i < w / 16; i++) {
    ctx.fillStyle = `hsl(28, 45%, ${28 + rand() * 10}%)`;
    ctx.fillRect(x0 + i * 16, y0, 15, h);
  }
  ctx.strokeStyle = "#2a1a0e";
  ctx.lineWidth = 4;
  ctx.strokeRect(x0 + 2, y0 + 2, w - 4, h - 4);
  return cv;
}

export function drawRug() {
  const cv = document.createElement("canvas");
  cv.width = 192;
  cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#6e1f2a";
  ctx.fillRect(0, 0, 192, 128);
  ctx.strokeStyle = "#d4a017";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 172, 108);
  ctx.fillStyle = "#1f3a6e";
  ctx.beginPath();
  ctx.ellipse(96, 64, 50, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

export function drawRoof() {
  const cv = document.createElement("canvas");
  cv.width = 320;
  cv.height = 320;
  const ctx = cv.getContext("2d");
  const rand = rng(5);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 9; c++) {
      ctx.fillStyle = `hsl(12, 45%, ${30 + rand() * 12}%)`;
      ctx.fillRect(c * 40 + (r % 2) * 20 - 20, r * 20, 39, 19);
    }
  }
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(156, 0, 8, 320);
  return cv;
}

/** Tileable stone-brick wall texture (one tile = one square). */
export function drawBricks() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  const rand = rng(3);
  ctx.fillStyle = "#3b3530";
  ctx.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 8; r++) {
    for (let c = -1; c < 4; c++) {
      const x = c * 40 + (r % 2) * 20, y = r * 16;
      ctx.fillStyle = `hsl(${20 + rand() * 15}, ${18 + rand() * 12}%, ${34 + rand() * 14}%)`;
      ctx.fillRect(x + 1, y + 1, 38, 14);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x + 1, y + 1, 38, 2);
    }
  }
  return cv;
}

/** Tileable wooden planks for doors. */
export function drawPlanks() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  const rand = rng(9);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `hsl(28, ${40 + rand() * 15}%, ${26 + rand() * 10}%)`;
    ctx.fillRect(i * 16, 0, 15, 128);
  }
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 30, 128, 6);
  ctx.fillRect(0, 92, 128, 6);
  return cv;
}

/**
 * Directional + animated sprite sheet for tests: 4 rows (front, left, back, right) x 2 frames.
 * Each cell shows a letter for its direction and a bobbing arm for its frame.
 */
export function drawSpriteSheet(color = "#2e86c1") {
  const cw = 128, ch = 160, rows = ["F", "L", "B", "R"], frames = 2;
  const cv = document.createElement("canvas");
  cv.width = cw * frames;
  cv.height = ch * rows.length;
  const ctx = cv.getContext("2d");
  rows.forEach((label, r) => {
    for (let f = 0; f < frames; f++) {
      const x = f * cw, y = r * ch;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + 24, y + ch - 4);
      ctx.quadraticCurveTo(x + cw / 2, y + 20, x + cw - 24, y + ch - 4);
      ctx.fill();
      ctx.fillStyle = label === "B" ? "#5b3a1a" : "#f0d0a8"; // back of the head shows hair
      ctx.beginPath();
      ctx.arc(x + cw / 2, y + 50, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 40px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + cw / 2, y + 125);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 6;
      ctx.beginPath(); // arm: up on frame 1
      ctx.moveTo(x + cw - 34, y + 95);
      ctx.lineTo(x + cw - 12, y + (f ? 60 : 110));
      ctx.stroke();
    }
  });
  return cv;
}
