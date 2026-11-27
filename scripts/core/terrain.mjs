/**
 * Height map -> raw geometry arrays (positions, normals, uvs, indices, groups). Pure, so it can be
 * unit-tested and fed to a three.js BufferGeometry.
 *
 * Every scene cell gets a top quad at its height, textured with its part of the background image.
 * Where a neighbour is lower (or the cell is on the map edge) a vertical side quad is added down
 * to the neighbour's height (0 outside the map). Sides reuse the cell's own texture, folded down
 * from the top edge, which gives the "extruded map" look of tactics games.
 *
 * Group 0 = tops, group 1 = sides.
 */
import { canvasToWorld, unitsToWorldY, cellRect } from "./coords.mjs";
import { getHeight } from "./heights.mjs";

/**
 * @param {object} map   height map {cols, rows, data}
 * @param {object} grid  makeGrid()
 * @param {{x:number,y:number,width:number,height:number}} bg  background image rect in canvas px
 */
export function buildTerrainArrays(map, grid, bg) {
  const tops = new QuadBuffer();
  const sides = new QuadBuffer();
  const uvAt = (px, py) => [(px - bg.x) / bg.width, 1 - (py - bg.y) / bg.height];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const h = unitsToWorldY(grid, getHeight(map, col, row));
      const r = cellRect(grid, col, row);
      const x0 = r.x, y0 = r.y, x1 = r.x + r.width, y1 = r.y + r.height;
      const p00 = canvasToWorld(grid, x0, y0);
      const p11 = canvasToWorld(grid, x1, y1);

      tops.quad(
        [[p00.x, h, p00.z], [p00.x, h, p11.z], [p11.x, h, p11.z], [p11.x, h, p00.z]],
        [uvAt(x0, y0), uvAt(x0, y1), uvAt(x1, y1), uvAt(x1, y0)],
        [0, 1, 0],
      );

      // Edges: [neighbour dc, dr, edge endpoints (canvas px), outward normal]
      const edges = [
        [0, -1, [x0, y0], [x1, y0], [0, 0, -1]],
        [0, 1, [x1, y1], [x0, y1], [0, 0, 1]],
        [-1, 0, [x0, y1], [x0, y0], [-1, 0, 0]],
        [1, 0, [x1, y0], [x1, y1], [1, 0, 0]],
      ];
      for (const [dc, dr, ea, eb, n] of edges) {
        const nh = unitsToWorldY(grid, getHeight(map, col + dc, row + dr));
        if (nh >= h) continue;
        const a = canvasToWorld(grid, ea[0], ea[1]);
        const b = canvasToWorld(grid, eb[0], eb[1]);
        // Top of the side samples the cell edge; the bottom samples further inside the cell
        // (up to half a square), so cliffs show the cell's texture "folded" down instead of
        // a 1-pixel streak (map grid lines often sit exactly on the edge).
        const fold = Math.min(h - nh, 1) * 0.5 * grid.size;
        const ia = [ea[0] - n[0] * fold, ea[1] - n[2] * fold];
        const ib = [eb[0] - n[0] * fold, eb[1] - n[2] * fold];
        const inset = 0.04 * grid.size;
        const ta = uvAt(ea[0] - n[0] * inset, ea[1] - n[2] * inset);
        const tb = uvAt(eb[0] - n[0] * inset, eb[1] - n[2] * inset);
        sides.quad(
          [[a.x, h, a.z], [a.x, nh, a.z], [b.x, nh, b.z], [b.x, h, b.z]],
          [ta, uvAt(ia[0], ia[1]), uvAt(ib[0], ib[1]), tb],
          n,
        );
      }
    }
  }
  return mergeBuffers(tops, sides);
}

class QuadBuffer {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
  }
  get vertexCount() {
    return this.positions.length / 3;
  }
  /** Add a quad; winding is fixed up so the front face points along `normal`. */
  quad(p, uv, normal) {
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) {
      this.positions.push(p[i][0], p[i][1], p[i][2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(uv[i][0], uv[i][1]);
    }
    const n = triangleNormal(p[0], p[1], p[2]);
    const ok = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] >= 0;
    if (ok) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

export function triangleNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function mergeBuffers(tops, sides) {
  const offset = tops.vertexCount;
  const cat = (Type, a, b) => {
    const out = new Type(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };
  const sideIdx = new Uint32Array(sides.indices.length);
  for (let i = 0; i < sideIdx.length; i++) sideIdx[i] = sides.indices[i] + offset;
  return {
    positions: cat(Float32Array, tops.positions, sides.positions),
    normals: cat(Float32Array, tops.normals, sides.normals),
    uvs: cat(Float32Array, tops.uvs, sides.uvs),
    indices: cat(Uint32Array, tops.indices, sideIdx),
    groups: [
      { start: 0, count: tops.indices.length, materialIndex: 0 },
      { start: tops.indices.length, count: sides.indices.length, materialIndex: 1 },
    ],
  };
}

/**
 * Grid line segments drawn slightly above each cell's top (positions for THREE.LineSegments).
 * Each cell draws its own outline so lines follow the terrain steps.
 */
export function buildGridLines(map, grid, lift = 0.01) {
  const out = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const h = unitsToWorldY(grid, getHeight(map, col, row)) + lift;
      const r = cellRect(grid, col, row);
      const a = canvasToWorld(grid, r.x, r.y);
      const b = canvasToWorld(grid, r.x + r.width, r.y + r.height);
      out.push(
        a.x, h, a.z, b.x, h, a.z,
        b.x, h, a.z, b.x, h, b.z,
        b.x, h, b.z, a.x, h, b.z,
        a.x, h, b.z, a.x, h, a.z,
      );
    }
  }
  return new Float32Array(out);
}
