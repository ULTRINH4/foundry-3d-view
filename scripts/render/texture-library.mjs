/**
 * The built-in texture library, drawn in code (original art, no image files). Every texture has
 * a colour canvas and, for relief under the 3D lights, a height canvas turned into a normal map.
 * Deterministic: the same id always draws the same picture.
 */
import { libraryEntry, LIBRARY_PREFIX } from "../core/library.mjs";

/* ------------------------------------------------------------------------------------------ */
/* helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const rgb = (r, g, b, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
const grey = (v, a = 1) => rgb(v, v, v, a);

/** Sprinkle small dots (grain) of random lightness over a rect, on colour and height. */
function grain(c, h, r, x, y, w, hh, amount, colorJitter = 18, heightJitter = 30) {
  for (let i = 0; i < amount; i++) {
    const px = x + r() * w, py = y + r() * hh, s = 1 + r() * 2.2;
    const d = (r() - 0.5) * 2;
    c.fillStyle = d > 0 ? `rgba(255,255,255,${0.05 + 0.08 * d})` : `rgba(0,0,0,${0.05 - 0.1 * d})`;
    c.fillRect(px, py, s, s);
    if (h) {
      h.fillStyle = grey(128 + d * heightJitter, 0.5);
      h.fillRect(px, py, s, s);
    }
  }
  void colorJitter;
}

/** A raised block: flat top, bevelled edges, on the height canvas. */
function bevelBlock(h, x, y, w, hh, bevel, top = 220) {
  for (let i = 0; i < bevel; i++) {
    h.fillStyle = grey(70 + ((top - 70) * (i + 1)) / bevel);
    h.fillRect(x + i, y + i, w - 2 * i, hh - 2 * i);
  }
}

/** Tileable value noise on a canvas (for rock, plaster, marble). */
function noiseField(w, h, r, cells) {
  const g = [];
  for (let j = 0; j <= cells; j++) {
    g.push([]);
    for (let i = 0; i <= cells; i++) g[j].push(r());
  }
  for (let i = 0; i <= cells; i++) g[cells][i] = g[0][i];
  for (let j = 0; j <= cells; j++) g[j][cells] = g[j][0];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = ((x / w) * cells) % cells, fy = ((y / h) * cells) % cells;
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = smooth(fx - i), ty = smooth(fy - j);
    const a = g[j][i] + (g[j][i + 1] - g[j][i]) * tx;
    const b = g[j + 1][i] + (g[j + 1][i + 1] - g[j + 1][i]) * tx;
    return a + (b - a) * ty;
  };
}

function fbm(w, h, r, octaves = 4, base = 4) {
  const layers = Array.from({ length: octaves }, (_, k) => noiseField(w, h, r, base << k));
  return (x, y) => {
    let v = 0, amp = 0.5, sum = 0;
    for (const n of layers) {
      v += n(x, y) * amp;
      sum += amp;
      amp *= 0.5;
    }
    return v / sum;
  };
}

/** Paint a per-pixel field into colour and height. */
function paintField(cv, hv, field, color, heightOf) {
  const w = cv.width, hgt = cv.height;
  const c = cv.getContext("2d"), hc = hv.getContext("2d");
  const ci = c.getImageData(0, 0, w, hgt), hi = hc.getImageData(0, 0, w, hgt);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const v = field(x, y);
      const [r, g, b, a = 255] = color(v, x, y);
      const k = (y * w + x) * 4;
      ci.data[k] = r;
      ci.data[k + 1] = g;
      ci.data[k + 2] = b;
      ci.data[k + 3] = a;
      const hh = heightOf(v, x, y);
      hi.data[k] = hi.data[k + 1] = hi.data[k + 2] = hh;
      hi.data[k + 3] = 255;
    }
  }
  c.putImageData(ci, 0, 0);
  hc.putImageData(hi, 0, 0);
}

/** Height canvas -> tangent-space normal map. */
function normalFromHeight(hv, strength = 2) {
  const w = hv.width, h = hv.height;
  const src = hv.getContext("2d").getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const oc = out.getContext("2d");
  const img = oc.createImageData(w, h);
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const k = (y * w + x) * 4;
      img.data[k] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[k + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
  return out;
}

/** Running-bond masonry: rows of blocks with mortar joints. */
function masonry(c, h, r, w, hh, { rows, cols, mortar, color, mortarColor, offset = 0.5, jitter = 0, bevel = 3 }) {
  c.fillStyle = mortarColor;
  c.fillRect(0, 0, w, hh);
  h.fillStyle = grey(60);
  h.fillRect(0, 0, w, hh);
  const rh = hh / rows;
  for (let row = 0; row < rows; row++) {
    const bw = w / cols;
    const shift = (row % 2) * offset * bw;
    for (let col = -1; col <= cols; col++) {
      const jw = jitter ? (r() - 0.5) * jitter * bw : 0;
      const x = col * bw + shift + mortar / 2, y = row * rh + mortar / 2;
      const bwid = bw - mortar + jw, bh = rh - mortar;
      c.fillStyle = color(r, row, col);
      c.fillRect(x, y, bwid, bh);
      bevelBlock(h, x, y, bwid, bh, bevel, 200 + r() * 40);
      // wrap horizontally so the texture tiles
      if (x + bwid > w) {
        c.fillRect(x - w, y, bwid, bh);
        bevelBlock(h, x - w, y, bwid, bh, bevel, 210);
      }
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* walls                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const WALLS = {
  "wall/stone-blocks": (c, h, r) => {
    masonry(c, h, r, 512, 512, {
      rows: 4, cols: 3, mortar: 8, mortarColor: "#3b3631", bevel: 6,
      color: (rr) => { const v = 120 + rr() * 45; return rgb(v + 8, v + 2, v - 10); },
    });
    grain(c, h, r, 0, 0, 512, 512, 2600);
  },
  "wall/dungeon-stone": (c, h, r) => {
    c.fillStyle = "#1d1f1c";
    c.fillRect(0, 0, 512, 512);
    h.fillStyle = grey(40);
    h.fillRect(0, 0, 512, 512);
    let y = 4;
    while (y < 512) {
      const rh = 46 + r() * 40;
      let x = -r() * 60;
      while (x < 512) {
        const bw = 50 + r() * 90;
        const v = 58 + r() * 34;
        const col = rgb(v - 4, v + 2, v - 6);
        const rad = 10 + r() * 10;
        for (const ox of [0, x + bw > 512 ? -512 : null].filter((o) => o !== null)) {
          c.fillStyle = col;
          c.beginPath();
          c.roundRect(x + ox + 3, y + 3, bw - 6, Math.min(rh, 512 - y) - 6, rad);
          c.fill();
          h.fillStyle = grey(150 + r() * 70);
          h.beginPath();
          h.roundRect(x + ox + 3, y + 3, bw - 6, Math.min(rh, 512 - y) - 6, rad);
          h.fill();
          h.fillStyle = grey(200 + r() * 40, 0.6);
          h.beginPath();
          h.roundRect(x + ox + 10, y + 10, bw - 20, Math.min(rh, 512 - y) - 20, rad);
          h.fill();
        }
        x += bw;
      }
      y += rh;
    }
    grain(c, h, r, 0, 0, 512, 512, 3500, 18, 50);
  },
  "wall/red-brick": (c, h, r) => {
    masonry(c, h, r, 256, 256, {
      rows: 8, cols: 4, mortar: 5, mortarColor: "#b9b0a2", bevel: 2,
      color: (rr) => rgb(140 + rr() * 50, 52 + rr() * 22, 38 + rr() * 16),
    });
    grain(c, h, r, 0, 0, 256, 256, 1400);
  },
  "wall/mossy-brick": (c, h, r) => {
    masonry(c, h, r, 256, 256, {
      rows: 8, cols: 4, mortar: 6, mortarColor: "#4f4a40", bevel: 2,
      color: (rr) => { const v = 92 + rr() * 30; return rgb(v + 10, v - 4, v - 16); },
    });
    // moss: green blotches, heavier at the bottom
    for (let i = 0; i < 160; i++) {
      const x = r() * 256, y = 256 * Math.pow(r(), 0.45), s = 4 + r() * 14;
      c.fillStyle = rgb(48 + r() * 30, 82 + r() * 40, 30 + r() * 15, 0.55);
      c.beginPath();
      c.arc(x, y, s, 0, Math.PI * 2);
      c.fill();
    }
    grain(c, h, r, 0, 0, 256, 256, 1600);
  },
  "wall/planks": (c, h, r) => {
    const boards = 6, bh = 256 / boards;
    for (let i = 0; i < boards; i++) {
      const v = 100 + r() * 30;
      c.fillStyle = rgb(v + 30, v - 5, v - 40);
      c.fillRect(0, i * bh, 256, bh);
      h.fillStyle = grey(200);
      h.fillRect(0, i * bh, 256, bh);
      c.strokeStyle = "rgba(50,28,12,0.35)";
      c.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const yy = i * bh + 4 + r() * (bh - 8);
        c.beginPath();
        c.moveTo(0, yy);
        for (let x = 0; x <= 256; x += 32) c.lineTo(x, yy + Math.sin(x * 0.05 + k + i) * 2);
        c.stroke();
      }
      c.fillStyle = "#2a170b";
      c.fillRect(0, i * bh, 256, 2);
      h.fillStyle = grey(40);
      h.fillRect(0, i * bh, 256, 3);
      // nails
      c.fillStyle = "#222";
      for (const x of [20 + r() * 10, 140 + r() * 20]) c.fillRect(x, i * bh + bh / 2 - 1, 3, 3);
    }
  },
  "wall/log-cabin": (c, h, r) => {
    const logs = 5, lh = 256 / logs;
    for (let i = 0; i < logs; i++) {
      const base = 95 + r() * 25;
      for (let y = 0; y < lh; y++) {
        const t = y / lh, round = Math.sin(t * Math.PI);
        c.fillStyle = rgb(base * (0.55 + 0.6 * round) + 25, base * (0.5 + 0.45 * round), base * (0.35 + 0.3 * round) - 5);
        c.fillRect(0, i * lh + y, 256, 1);
        h.fillStyle = grey(40 + 200 * round);
        h.fillRect(0, i * lh + y, 256, 1);
      }
      c.strokeStyle = "rgba(40,22,8,0.3)";
      for (let k = 0; k < 5; k++) {
        const yy = i * lh + lh * (0.25 + 0.5 * r());
        c.beginPath();
        c.moveTo(0, yy);
        c.bezierCurveTo(80, yy + 3, 170, yy - 3, 256, yy);
        c.stroke();
      }
    }
  },
  "wall/plaster": (c, h, r) => {
    const n = fbm(256, 256, r, 4, 4);
    paintField(c.canvas, h.canvas, n, (v) => { const k = 205 + v * 40; return [k, k - 6, k - 18]; }, (v) => 110 + v * 70);
    // a few hairline cracks and a damp line at the bottom
    c.strokeStyle = "rgba(90,80,70,0.35)";
    for (let i = 0; i < 4; i++) {
      let x = r() * 256, y = r() * 256;
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 6; k++) c.lineTo((x += (r() - 0.5) * 30), (y += 8 + r() * 10));
      c.stroke();
    }
    const grad = c.createLinearGradient(0, 200, 0, 256);
    grad.addColorStop(0, "rgba(90,80,60,0)");
    grad.addColorStop(1, "rgba(90,80,60,0.25)");
    c.fillStyle = grad;
    c.fillRect(0, 200, 256, 56);
  },
  "wall/timber-frame": (c, h, r) => {
    // plaster panels between dark oak beams (a 2:1 tile)
    const n = fbm(512, 256, r, 3, 4);
    paintField(c.canvas, h.canvas, n, (v) => { const k = 215 + v * 30; return [k, k - 8, k - 24]; }, (v) => 100 + v * 50);
    const beam = (x, y, w, hh) => {
      c.fillStyle = rgb(70 + r() * 15, 44, 26);
      c.fillRect(x, y, w, hh);
      h.fillStyle = grey(225);
      h.fillRect(x, y, w, hh);
    };
    beam(0, 0, 512, 22);
    beam(0, 234, 512, 22);
    beam(0, 120, 512, 16);
    for (const x of [0, 170, 340]) beam(x, 0, 20, 256);
    // diagonal braces
    c.save();
    h.save();
    for (const [x0, flip] of [[20, 1], [190, -1], [360, 1]]) {
      for (const ctx of [c, h]) {
        ctx.translate(x0 + 75, 128);
        ctx.rotate(flip * 0.72);
        ctx.fillStyle = ctx === c ? rgb(74, 46, 27) : grey(225);
        ctx.fillRect(-100, -8, 200, 16);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    c.restore();
    h.restore();
    grain(c, null, r, 0, 0, 512, 256, 1800);
  },
  "wall/cave-rock": (c, h, r) => {
    const n = fbm(512, 512, r, 5, 3);
    const n2 = fbm(512, 512, r, 3, 8);
    paintField(c.canvas, h.canvas, (x, y) => n(x, y) * 0.7 + n2(x, y) * 0.3,
      (v) => { const t = Math.min(1, Math.max(0, (v - 0.3) * 2.6)); const k = 28 + t * 120; return [k + 16, k + 6, k - 4]; },
      (v) => Math.min(255, Math.max(0, (v - 0.3) * 2.6 * 255)));
    c.strokeStyle = "rgba(15,10,8,0.6)";
    c.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      let x = r() * 512, y = r() * 512;
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 8; k++) c.lineTo((x += (r() - 0.5) * 70), (y += (r() - 0.3) * 50));
      c.stroke();
    }
  },
  "wall/marble": (c, h, r) => {
    const n = fbm(512, 512, r, 5, 3);
    paintField(c.canvas, h.canvas, (x, y) => Math.abs(Math.sin((x * 0.02 + y * 0.012) + n(x, y) * 9)),
      (v) => { const vein = Math.pow(1 - v, 6); const k = 232 - vein * 120; return [k, k - 2, k + 4]; },
      () => 200);
    // slab joints
    c.fillStyle = "rgba(120,115,110,0.6)";
    h.fillStyle = grey(70);
    for (const y of [0, 256]) { c.fillRect(0, y, 512, 3); h.fillRect(0, y, 512, 3); }
    for (const [x, y] of [[0, 0], [256, 256]]) { c.fillRect(x, y, 3, 256); h.fillRect(x, y, 3, 256); }
  },
  "wall/metal-panels": (c, h, r) => {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const v = 92 + r() * 18;
        c.fillStyle = rgb(v - 6, v + 2, v + 14);
        c.fillRect(i * 128, j * 128, 128, 128);
        bevelBlock(h, i * 128 + 2, j * 128 + 2, 124, 124, 4, 210);
        c.fillStyle = "#1a1d22";
        c.fillRect(i * 128, j * 128, 128, 3);
        c.fillRect(i * 128, j * 128, 3, 128);
        // rivets
        for (const [rx, ry] of [[10, 10], [116, 10], [10, 116], [116, 116]]) {
          c.fillStyle = "#c8ccd2";
          c.beginPath();
          c.arc(i * 128 + rx, j * 128 + ry, 3, 0, Math.PI * 2);
          c.fill();
          h.fillStyle = grey(255);
          h.beginPath();
          h.arc(i * 128 + rx, j * 128 + ry, 3, 0, Math.PI * 2);
          h.fill();
        }
      }
    }
    // vent slots on one panel
    for (let k = 0; k < 5; k++) {
      c.fillStyle = "#0e1013";
      c.fillRect(150, 30 + k * 14, 84, 6);
      h.fillStyle = grey(40);
      h.fillRect(150, 30 + k * 14, 84, 6);
    }
    c.fillStyle = "rgba(255,190,40,0.8)";
    c.fillRect(0, 248, 256, 8);
    grain(c, null, r, 0, 0, 256, 256, 900);
  },
  "wall/hedge": (c, h, r) => {
    c.fillStyle = "#1e3a17";
    c.fillRect(0, 0, 256, 256);
    h.fillStyle = grey(60);
    h.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      const x = r() * 256, y = r() * 256, s = 3 + r() * 6, a = r() * Math.PI;
      const g = 70 + r() * 70;
      for (const ox of [0, x + s > 256 ? -256 : null, x - s < 0 ? 256 : null].filter((o) => o !== null)) {
        c.fillStyle = rgb(g * 0.45, g, g * 0.35);
        c.beginPath();
        c.ellipse(x + ox, y, s, s * 0.45, a, 0, Math.PI * 2);
        c.fill();
        h.fillStyle = grey(110 + r() * 140);
        h.beginPath();
        h.ellipse(x + ox, y, s, s * 0.45, a, 0, Math.PI * 2);
        h.fill();
      }
    }
  },
  // Window frames (solid parts around the pane, tiled like walls)
  "window/wood-frame": (c, h, r) => WALLS["wall/planks"](c, h, r),
  "window/stone-frame": (c, h, r) => {
    masonry(c, h, r, 256, 256, {
      rows: 2, cols: 2, mortar: 4, mortarColor: "#8d877d", bevel: 5,
      color: (rr) => { const v = 175 + rr() * 30; return rgb(v, v - 4, v - 14); },
    });
    grain(c, h, r, 0, 0, 256, 256, 1200);
  },
};

/* ------------------------------------------------------------------------------------------ */
/* doors (256 x 512, fitted once on each leaf)                                                 */
/* ------------------------------------------------------------------------------------------ */

function doorPlanks(c, h, r, base, planks = 4, frame = 18) {
  c.fillStyle = rgb(base[0] * 0.55, base[1] * 0.55, base[2] * 0.55);
  c.fillRect(0, 0, 256, 512);
  h.fillStyle = grey(90);
  h.fillRect(0, 0, 256, 512);
  const pw = (256 - frame * 2) / planks;
  for (let i = 0; i < planks; i++) {
    const k = 0.9 + r() * 0.2;
    c.fillStyle = rgb(base[0] * k, base[1] * k, base[2] * k);
    c.fillRect(frame + i * pw + 2, frame, pw - 4, 512 - frame * 2);
    h.fillStyle = grey(200);
    h.fillRect(frame + i * pw + 2, frame, pw - 4, 512 - frame * 2);
    c.strokeStyle = "rgba(40,22,10,0.35)";
    c.lineWidth = 2;
    for (let y = 40 + i * 23; y < 490; y += 70) {
      c.beginPath();
      c.moveTo(frame + i * pw + 8, y);
      c.bezierCurveTo(frame + i * pw + pw * 0.4, y + 8, frame + i * pw + pw * 0.6, y - 8, frame + i * pw + pw - 8, y + 4);
      c.stroke();
    }
  }
}

function knob(c, h, x, y, color = "#c9a54a", rad = 11) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, rad, 0, Math.PI * 2);
  c.fill();
  h.fillStyle = grey(255);
  h.beginPath();
  h.arc(x, y, rad, 0, Math.PI * 2);
  h.fill();
}

const DOORS = {
  "door/wood": (c, h, r) => {
    doorPlanks(c, h, r, [135, 88, 52]);
    for (const y of [120, 370]) {
      c.fillStyle = "#3a2414";
      c.fillRect(18, y, 220, 22);
      h.fillStyle = grey(235);
      h.fillRect(18, y, 220, 22);
    }
    knob(c, h, 206, 262);
  },
  "door/reinforced": (c, h, r) => {
    doorPlanks(c, h, r, [110, 72, 44]);
    for (const y of [70, 250, 430]) {
      c.fillStyle = "#2b2b2e";
      c.fillRect(0, y, 256, 26);
      h.fillStyle = grey(245);
      h.fillRect(0, y, 256, 26);
      for (let x = 14; x < 256; x += 40) knob(c, h, x, y + 13, "#8d9096", 4);
    }
    // ring handle
    c.strokeStyle = "#1c1c1f";
    c.lineWidth = 6;
    c.beginPath();
    c.arc(205, 200, 18, 0, Math.PI * 2);
    c.stroke();
  },
  "door/double-ornate": (c, h, r) => {
    c.fillStyle = "#4a1f12";
    c.fillRect(0, 0, 256, 512);
    h.fillStyle = grey(120);
    h.fillRect(0, 0, 256, 512);
    for (const x0 of [10, 132]) {
      c.fillStyle = "#7a3a20";
      c.fillRect(x0, 10, 114, 492);
      h.fillStyle = grey(190);
      h.fillRect(x0, 10, 114, 492);
      for (const [y, hh] of [[34, 190], [250, 230]]) {
        c.fillStyle = "#5e2a17";
        c.fillRect(x0 + 16, y, 82, hh);
        bevelBlock(h, x0 + 16, y, 82, hh, 8, 235);
        c.strokeStyle = "rgba(220,170,80,0.6)";
        c.lineWidth = 2;
        c.strokeRect(x0 + 22, y + 6, 70, hh - 12);
      }
    }
    c.fillStyle = "#1c0b05";
    c.fillRect(124, 0, 8, 512);
    knob(c, h, 112, 250, "#e0b94f", 8);
    knob(c, h, 144, 250, "#e0b94f", 8);
  },
  "door/iron-gate": (c, h) => {
    c.clearRect(0, 0, 256, 512);
    h.fillStyle = grey(0);
    h.fillRect(0, 0, 256, 512);
    const bar = (x, y, w, hh) => {
      c.fillStyle = "#26272b";
      c.fillRect(x, y, w, hh);
      c.fillStyle = "rgba(255,255,255,0.18)";
      c.fillRect(x, y, Math.max(2, w * 0.3), hh);
      h.fillStyle = grey(230);
      h.fillRect(x, y, w, hh);
    };
    for (let x = 14; x < 256; x += 34) {
      bar(x, 30, 12, 482);
      c.fillStyle = "#26272b";
      c.beginPath();
      c.moveTo(x - 6, 34);
      c.lineTo(x + 6, 4);
      c.lineTo(x + 18, 34);
      c.fill();
    }
    for (const y of [60, 260, 470]) bar(0, y, 256, 14);
    bar(0, 0, 8, 512);
    bar(248, 0, 8, 512);
  },
  "door/stone-slab": (c, h, r) => {
    const n = fbm(256, 512, r, 4, 4);
    paintField(c.canvas, h.canvas, n, (v) => { const k = 110 + v * 50; return [k, k, k - 8]; }, (v) => 150 + v * 60);
    c.strokeStyle = "rgba(30,30,30,0.7)";
    c.lineWidth = 4;
    c.beginPath();
    c.arc(128, 220, 60, 0, Math.PI * 2);
    c.stroke();
    h.strokeStyle = grey(40);
    h.lineWidth = 5;
    h.beginPath();
    h.arc(128, 220, 60, 0, Math.PI * 2);
    h.stroke();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      for (const ctx of [c, h]) {
        ctx.beginPath();
        ctx.moveTo(128 + Math.cos(a) * 30, 220 + Math.sin(a) * 30);
        ctx.lineTo(128 + Math.cos(a + 0.6) * 52, 220 + Math.sin(a + 0.6) * 52);
        ctx.stroke();
      }
    }
  },
  "door/scifi": (c, h) => {
    c.fillStyle = "#5c6470";
    c.fillRect(0, 0, 256, 512);
    bevelBlock(h, 0, 0, 256, 512, 10, 210);
    c.fillStyle = "#3a4048";
    c.fillRect(124, 0, 8, 512);
    h.fillStyle = grey(60);
    h.fillRect(124, 0, 8, 512);
    // hazard chevrons
    c.save();
    c.beginPath();
    c.rect(20, 220, 216, 60);
    c.clip();
    c.fillStyle = "#f2c230";
    c.fillRect(20, 220, 216, 60);
    c.fillStyle = "#1d1d1d";
    for (let x = -60; x < 260; x += 36) {
      c.beginPath();
      c.moveTo(x, 280);
      c.lineTo(x + 18, 280);
      c.lineTo(x + 78, 220);
      c.lineTo(x + 60, 220);
      c.fill();
    }
    c.restore();
    for (const [x, col] of [[60, "#4ef0ff"], [196, "#4ef0ff"]]) {
      c.fillStyle = col;
      c.fillRect(x - 3, 40, 6, 120);
      c.fillRect(x - 3, 340, 6, 120);
    }
  },
  "door/barn": (c, h, r) => {
    doorPlanks(c, h, r, [150, 52, 40], 5, 14);
    c.fillStyle = "#e9e2d6";
    h.fillStyle = grey(240);
    for (const [x, y, w, hh] of [[0, 0, 256, 20], [0, 492, 256, 20], [0, 0, 20, 512], [236, 0, 20, 512], [0, 246, 256, 20]]) {
      c.fillRect(x, y, w, hh);
      h.fillRect(x, y, w, hh);
    }
    for (const [y0, flip] of [[20, 1], [266, 1]]) {
      for (const ctx of [c, h]) {
        ctx.save();
        ctx.translate(128, y0 + 113);
        ctx.rotate(flip * -1.08);
        ctx.fillStyle = ctx === c ? "#e9e2d6" : grey(240);
        ctx.fillRect(-130, -10, 260, 20);
        ctx.restore();
      }
    }
  },
};

/* ------------------------------------------------------------------------------------------ */
/* glass (with transparency)                                                                   */
/* ------------------------------------------------------------------------------------------ */

const GLASS = {
  "glass/clear": (c) => {
    c.fillStyle = "rgba(190,225,255,0.22)";
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = "rgba(255,255,255,0.35)";
    for (const [x, w] of [[40, 18], [70, 6], [170, 10]]) {
      c.save();
      c.translate(x, 0);
      c.transform(1, 0, -0.5, 1, 0, 0);
      c.fillRect(0, 0, w, 256);
      c.restore();
    }
  },
  "glass/frosted": (c, h, r) => {
    c.fillStyle = "rgba(235,242,248,0.62)";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      c.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.2})`;
      c.fillRect(r() * 256, r() * 256, 2, 2);
    }
  },
  "glass/stained": (c, h, r) => {
    c.fillStyle = "rgba(20,20,20,0.95)";
    c.fillRect(0, 0, 256, 256);
    const colors = [[200, 40, 40], [40, 80, 200], [230, 190, 40], [40, 150, 70], [140, 50, 170]];
    const cell = 64;
    for (let y = 0; y < 256; y += cell) {
      for (let x = 0; x < 256; x += cell) {
        for (const tri of [[[0, 0], [cell, 0], [0, cell]], [[cell, 0], [cell, cell], [0, cell]]]) {
          const [cr, cg, cb] = colors[Math.floor(r() * colors.length)];
          c.fillStyle = rgb(cr, cg, cb, 0.72);
          c.beginPath();
          tri.forEach(([tx, ty], k) => (k ? c.lineTo(x + tx, y + ty) : c.moveTo(x + tx, y + ty)));
          c.closePath();
          c.fill();
          c.strokeStyle = "rgba(15,15,15,0.95)";
          c.lineWidth = 4;
          c.stroke();
        }
      }
    }
  },
};

const DRAW = { ...WALLS, ...DOORS, ...GLASS };
const SIZE = { "wall/stone-blocks": [512, 512], "wall/dungeon-stone": [512, 512], "wall/timber-frame": [512, 256], "wall/cave-rock": [512, 512], "wall/marble": [512, 512] };

const cache = new Map();

/**
 * Draw a library texture.
 * @param {string} src  "f3d:<kind>/<name>"
 * @returns {{color: HTMLCanvasElement, normal: HTMLCanvasElement|null, alpha: boolean}|null}
 */
export function drawLibraryTexture(src) {
  const e = libraryEntry(src);
  if (!e) return null;
  if (cache.has(e.id)) return cache.get(e.id);
  const [w, h] = SIZE[e.id] ?? (e.kind === "door" ? [256, 512] : [256, 256]);
  const color = canvas(w, h), height = canvas(w, h);
  const c = color.getContext("2d"), hc = height.getContext("2d", { willReadFrequently: true });
  hc.fillStyle = grey(128);
  hc.fillRect(0, 0, w, h);
  let seed = 0;
  for (const ch of e.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  DRAW[e.id](c, hc, rng(seed));
  const out = { color, normal: e.kind === "glass" || e.id === "door/iron-gate" ? null : normalFromHeight(height, e.kind === "door" ? 2.5 : 3), alpha: !!e.alpha };
  cache.set(e.id, out);
  return out;
}

const thumbs = new Map();
/** Small preview (data URL) for the library picker. */
export function libraryThumbnail(src, size = 96) {
  if (thumbs.has(src)) return thumbs.get(src);
  const t = drawLibraryTexture(src);
  if (!t) return "";
  const ratio = t.color.width / t.color.height;
  const c = canvas(ratio >= 1 ? size : Math.round(size * ratio), ratio >= 1 ? Math.round(size / ratio) : size);
  const ctx = c.getContext("2d");
  // checkerboard behind see-through textures
  if (t.alpha) {
    for (let y = 0; y < c.height; y += 8) for (let x = 0; x < c.width; x += 8) {
      ctx.fillStyle = (x + y) % 16 ? "#777" : "#aaa";
      ctx.fillRect(x, y, 8, 8);
    }
  }
  ctx.drawImage(t.color, 0, 0, c.width, c.height);
  const url = c.toDataURL();
  thumbs.set(src, url);
  return url;
}

export { LIBRARY_PREFIX };
