/**
 * Ambience particles in the 3D view: Foundry's scene weather (rain, snow, leaves, fog) and dust
 * floating in the air. Particles live in a box that follows the camera target, so they cost the
 * same on any map size, and wrap around inside it.
 */
import * as THREE from "../../vendor/three/three.module.js";
import { weatherFor } from "../core/library.mjs";

const BOX = { w: 26, d: 26, h: 9 }; // world units around the camera target

function spriteTexture(draw, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SPRITES = {
  soft: () => spriteTexture((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  }),
  leaf: () => spriteTexture((g, s) => {
    g.translate(s / 2, s / 2);
    g.rotate(0.6);
    g.fillStyle = "#c8742a";
    g.beginPath();
    g.ellipse(0, 0, s * 0.42, s * 0.2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#7a3f12";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-s * 0.4, 0);
    g.lineTo(s * 0.4, 0);
    g.stroke();
  }),
};

export class Ambience {
  /** @param {import("./view3d.mjs").View3D} view */
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.group.name = "ambience";
    this.group.renderOrder = 8;
    view.scene.add(this.group);
    this.weather = null; // { id, kind, points|lines, pos, vel, count }
    this.dust = null;
    this._sprites = {};
  }

  _sprite(name) {
    return (this._sprites[name] ??= SPRITES[name]());
  }

  /** Foundry scene weather id ("rain", "snow", "fog", ...) or null. */
  setWeather(id) {
    const w = weatherFor(id);
    if (this.weather?.id === id && w) return;
    this._dispose(this.weather);
    this.weather = null;
    if (!w) return;
    const n = w.count;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX.w;
      pos[i * 3 + 1] = Math.random() * BOX.h;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.d;
      seed[i] = Math.random() * 100;
    }
    let obj;
    if (w.kind === "rain") {
      // Streaks: two vertices per drop
      const line = new Float32Array(n * 6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(line, 3));
      obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaecbe6, transparent: true, opacity: 0.55, depthWrite: false }));
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos.slice(), 3));
      const opts = {
        snow: { size: 0.09, map: this._sprite("soft"), color: 0xffffff, opacity: 0.95 },
        leaves: { size: 0.28, map: this._sprite("leaf"), color: 0xffffff, opacity: 1 },
        fog: { size: 9, map: this._sprite("soft"), color: 0xdfe6ec, opacity: 0.09 },
      }[w.kind];
      obj = new THREE.Points(geo, new THREE.PointsMaterial({
        size: opts.size, map: opts.map, color: opts.color, transparent: true, opacity: opts.opacity,
        depthWrite: false, sizeAttenuation: true, alphaTest: w.kind === "leaves" ? 0.3 : 0,
      }));
      if (w.kind === "fog") for (let i = 0; i < n; i++) pos[i * 3 + 1] = 0.2 + Math.random() * 1.6;
    }
    obj.frustumCulled = false;
    obj.userData.isAmbience = true;
    obj.userData.worldSize = obj.material.size;
    this.group.add(obj);
    this.weather = { id, ...w, obj, pos, seed, n };
  }

  /** Dust specks drifting in the air (themes such as dungeons and caves). */
  setDust(on) {
    if (!!this.dust === !!on) return;
    this._dispose(this.dust);
    this.dust = null;
    if (!on) return;
    const n = 260;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = 0.2 + Math.random() * 2.6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos.slice(), 3));
    const obj = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.05, map: this._sprite("soft"), color: 0xffe2b0, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    obj.frustumCulled = false;
    obj.userData.isAmbience = true;
    obj.userData.worldSize = obj.material.size;
    this.group.add(obj);
    this.dust = { obj, pos, seed, n, box: 18 };
  }

  _dispose(p) {
    if (!p) return;
    p.obj.removeFromParent();
    p.obj.geometry.dispose();
    p.obj.material.dispose();
  }

  /**
   * Point sizes are in world units: three.js only attenuates them with a perspective camera, so
   * with the orthographic (tactics) camera convert them to pixels for the current zoom.
   */
  _sizePoints(obj) {
    if (!obj?.isPoints) return;
    const cam = this.view.camera, el = this.view.renderer.domElement;
    obj.material.size = cam.isOrthographicCamera
      ? obj.userData.worldSize * (el.height / ((cam.top - cam.bottom) / (cam.zoom || 1)))
      : obj.userData.worldSize;
  }

  /** Advance the particles; called every frame. */
  update(dt, time) {
    this._sizePoints(this.weather?.obj);
    this._sizePoints(this.dust?.obj);
    const target = this.view.controls.target;
    const base = target.y; // the camera looks at the ground
    // Weather and dust dim with the scene darkness, like everything else
    const light = 1 - 0.65 * (this.view.darkness ?? 0);
    const w = this.weather;
    if (w) {
      const { pos, seed, n } = w;
      const fall = w.speed * dt;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        if (w.kind === "rain") pos[k + 1] -= fall;
        else if (w.kind === "snow") {
          pos[k + 1] -= fall * (0.7 + 0.3 * Math.sin(seed[i]));
          pos[k] += Math.sin(time * 0.8 + seed[i]) * dt * 0.4;
        } else if (w.kind === "leaves") {
          pos[k + 1] -= fall;
          pos[k] += (Math.sin(time * 1.3 + seed[i]) + 0.6) * dt * 0.8;
          pos[k + 2] += Math.cos(time * 1.1 + seed[i]) * dt * 0.5;
        } else {
          pos[k] += (0.25 + 0.1 * Math.sin(seed[i])) * dt * w.speed * 4;
        }
        if (pos[k + 1] < 0) pos[k + 1] += BOX.h;
        if (pos[k] > BOX.w / 2) pos[k] -= BOX.w;
        if (pos[k] < -BOX.w / 2) pos[k] += BOX.w;
      }
      const ox = target.x, oz = target.z;
      const attr = w.obj.geometry.attributes.position;
      if (w.kind === "rain") {
        const a = attr.array, len = 0.35 + w.speed * 0.02;
        for (let i = 0; i < n; i++) {
          const k = i * 3, j = i * 6;
          const x = pos[k] + ox, y = pos[k + 1] + base, z = pos[k + 2] + oz;
          a[j] = x; a[j + 1] = y; a[j + 2] = z;
          a[j + 3] = x + 0.04; a[j + 4] = y + len; a[j + 5] = z + 0.02;
        }
      } else {
        const a = attr.array;
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          a[k] = pos[k] + ox;
          a[k + 1] = pos[k + 1] + base;
          a[k + 2] = pos[k + 2] + oz;
        }
      }
      attr.needsUpdate = true;
      w.obj.material.color.setScalar(light).multiply(new THREE.Color(w.kind === "rain" ? 0xaecbe6 : w.kind === "fog" ? 0xdfe6ec : 0xffffff));
    }
    const d = this.dust;
    if (d) {
      const { pos, seed, n, box } = d;
      const a = d.obj.geometry.attributes.position.array;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        pos[k] += Math.sin(time * 0.3 + seed[i]) * dt * 0.12;
        pos[k + 1] += Math.sin(time * 0.5 + seed[i] * 1.7) * dt * 0.06;
        pos[k + 2] += Math.cos(time * 0.27 + seed[i]) * dt * 0.12;
        if (pos[k] > box / 2) pos[k] -= box;
        if (pos[k] < -box / 2) pos[k] += box;
        if (pos[k + 2] > box / 2) pos[k + 2] -= box;
        if (pos[k + 2] < -box / 2) pos[k + 2] += box;
        a[k] = pos[k] + target.x;
        a[k + 1] = pos[k + 1] + base;
        a[k + 2] = pos[k + 2] + target.z;
      }
      d.obj.geometry.attributes.position.needsUpdate = true;
      d.obj.material.opacity = (0.35 + 0.2 * Math.sin(time * 0.7)) * (0.4 + 0.6 * (this.view.darkness ?? 0) + 0.3);
    }
  }

  get weatherCount() {
    return this.weather?.n ?? 0;
  }

  destroy() {
    this._dispose(this.weather);
    this._dispose(this.dust);
    this.group.removeFromParent();
    for (const t of Object.values(this._sprites)) t.dispose();
  }
}
