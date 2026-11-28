/**
 * Foundry 3D View fields in the Wall configuration sheet:
 *  - walls: "3D texture" (flags.foundry-3d-view.texture), its fit (repeat / wall height) and size
 *  - doors: "3D door texture" (flags.foundry-3d-view.doorTexture) and its mode (fit / repeat)
 *  - "3D height":  height in grid squares (flags.foundry-3d-view.height), e.g. 0.5 = half wall
 * Plus a bulk tool (Walls controls) that applies texture/height to every selected wall.
 * Works with v13/v14 ApplicationV2 sheets (html is an HTMLElement, <file-picker> element) and falls
 * back to plain inputs on older sheets (html is jQuery).
 */
import { MODULE_ID } from "../core/constants.mjs";
import { libraryButton } from "./library-picker.mjs";

const TEX = `flags.${MODULE_ID}.texture`;
const HEIGHT = `flags.${MODULE_ID}.height`;
const t = (k) => game.i18n.localize(k);
const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

function textureField(name, value) {
  return customElements.get("file-picker")
    ? `<file-picker name="${name}" type="image" value="${esc(value)}"></file-picker>`
    : `<input type="text" name="${name}" value="${esc(value)}" placeholder="path/to/texture.webp">`;
}

const FLAG = (k) => `flags.${MODULE_ID}.${k}`;

function select(name, value, options) {
  return `<select name="${name}">${options.map(([v, label]) => `<option value="${v}"${(value ?? "") === v ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
}

const fitOptions = () => [["", t("F3D.WallConfig.UseSetting")], ["repeat", t("F3D.TextureFit.repeat")], ["height", t("F3D.TextureFit.height")]];
const doorModeOptions = () => [["", t("F3D.WallConfig.UseSetting")], ["fit", t("F3D.DoorTextureMode.fit")], ["repeat", t("F3D.DoorTextureMode.repeat")]];

export function injectWallConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = app.document ?? app.object;
  if (!root || !doc || root.querySelector(".f3d-wall-texture")) return;
  const height = doc.getFlag(MODULE_ID, "height");
  const isDoor = Number(doc.door) > 0;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "f3d-wall-texture";
  const textureRows = isDoor
    ? `
    <div class="form-group">
      <label>${t("F3D.WallConfig.DoorTexture")}</label>
      <div class="form-fields">${textureField(FLAG("doorTexture"), doc.getFlag(MODULE_ID, "doorTexture") ?? "")}${libraryButton(FLAG("doorTexture"), "door")}</div>
      <p class="hint">${t("F3D.WallConfig.DoorTextureHint")}</p>
    </div>
    <div class="form-group">
      <label>${t("F3D.WallConfig.DoorTextureMode")}</label>
      <div class="form-fields">${select(FLAG("doorTextureMode"), doc.getFlag(MODULE_ID, "doorTextureMode"), doorModeOptions())}</div>
    </div>`
    : `
    <div class="form-group">
      <label>${t("F3D.WallConfig.Texture")}</label>
      <div class="form-fields">${textureField(TEX, doc.getFlag(MODULE_ID, "texture") ?? "")}${libraryButton(TEX, "wall")}</div>
      <p class="hint">${t("F3D.WallConfig.TextureHint")}</p>
    </div>
    <div class="form-group">
      <label>${t("F3D.WallConfig.TextureFit")}</label>
      <div class="form-fields">${select(FLAG("textureFit"), doc.getFlag(MODULE_ID, "textureFit"), fitOptions())}
        <input type="number" name="${FLAG("textureScale")}" value="${doc.getFlag(MODULE_ID, "textureScale") ?? ""}" step="0.25" min="0.25" placeholder="${t("F3D.WallConfig.TextureScale")}"></div>
      <p class="hint">${t("F3D.WallConfig.TextureFitHint")}</p>
    </div>`;
  fieldset.innerHTML = `
    <legend>${t("F3D.WallConfig.Legend")}</legend>${textureRows}
    <div class="form-group">
      <label>${t("F3D.WallConfig.Height")}</label>
      <div class="form-fields">
        <input type="number" name="${HEIGHT}" value="${height ?? ""}" step="0.05" min="0.05" placeholder="${t("F3D.WallConfig.HeightDefault")}">
      </div>
      <p class="hint">${t("F3D.WallConfig.HeightHint")}</p>
    </div>`;
  // v14 wraps the body in a scrollable .standard-form: append inside it. v13: before the footer.
  const form = root.tagName === "FORM" ? root : root.querySelector("form") ?? root;
  const body = form.querySelector(".standard-form.scrollable, .scrollable");
  if (body) {
    body.appendChild(fieldset);
  } else {
    const footer = form.querySelector("footer, .form-footer, .sheet-footer, button[type=submit]");
    const anchor = footer?.closest?.("footer, .form-footer, .sheet-footer") ?? footer;
    if (anchor?.parentElement) anchor.parentElement.insertBefore(fieldset, anchor);
    else form.appendChild(fieldset);
  }
  if (typeof app.setPosition === "function") app.setPosition({ height: "auto" });
}

/** Height presets offered by the bulk tool (grid squares; "" = module default). */
export const HEIGHT_PRESETS = Object.freeze({ keep: null, default: "", full: 2, tall: 1.5, half: 0.5, low: 0.25 });

/**
 * Build the flag update for one wall from the bulk dialog values. Walls take the wall texture
 * (with its fit and size), doors take the door texture: they never get each other's.
 * @param {{texture:string, doorTexture?:string, fit?:string, scale?:string, clearTexture:boolean, preset:string, custom:string}} v
 * @param {boolean} [isDoor]
 */
export function bulkWallUpdate(id, v, isDoor = false) {
  const u = { _id: id };
  if (isDoor) {
    if (v.clearTexture) u[`flags.${MODULE_ID}.-=doorTexture`] = null;
    else if (v.doorTexture) u[FLAG("doorTexture")] = v.doorTexture;
  } else {
    if (v.clearTexture) u[`flags.${MODULE_ID}.-=texture`] = null;
    else if (v.texture) u[TEX] = v.texture;
    if (v.fit === "repeat" || v.fit === "height") u[FLAG("textureFit")] = v.fit;
    if (Number(v.scale) > 0) u[FLAG("textureScale")] = Number(v.scale);
  }
  if (v.preset === "custom" && Number(v.custom) > 0) u[HEIGHT] = Number(v.custom);
  else if (v.preset === "default") u[`flags.${MODULE_ID}.-=height`] = null;
  else if (v.preset in HEIGHT_PRESETS && HEIGHT_PRESETS[v.preset] !== null && HEIGHT_PRESETS[v.preset] !== "") u[HEIGHT] = HEIGHT_PRESETS[v.preset];
  return u;
}

/** Walls controls button: apply a texture and/or height to every selected wall. */
export async function openBulkWallDialog() {
  const walls = canvas.walls?.controlled ?? [];
  if (!walls.length) return ui.notifications.warn(t("F3D.WallTools.SelectFirst"));
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const presets = ["keep", "default", "full", "tall", "half", "low", "custom"]
    .map((k) => `<option value="${k}">${t(`F3D.WallTools.Preset.${k}`)}</option>`).join("");
  const content = `
    <p>${game.i18n.format("F3D.WallTools.Count", { n: walls.length })}</p>
    <div class="form-group"><label>${t("F3D.WallConfig.Texture")}</label>
      <div class="form-fields">${textureField("texture", "")}${libraryButton("texture", "wall")}</div></div>
    <div class="form-group"><label>${t("F3D.WallConfig.TextureFit")}</label>
      <div class="form-fields">${select("fit", "", [["", t("F3D.WallTools.Keep")], ["repeat", t("F3D.TextureFit.repeat")], ["height", t("F3D.TextureFit.height")]])}
      <input type="number" name="scale" step="0.25" min="0.25" placeholder="${t("F3D.WallConfig.TextureScale")}"></div></div>
    <div class="form-group"><label>${t("F3D.WallConfig.DoorTexture")}</label>
      <div class="form-fields">${textureField("doorTexture", "")}${libraryButton("doorTexture", "door")}</div></div>
    <div class="form-group"><label>${t("F3D.WallTools.ClearTexture")}</label>
      <div class="form-fields"><input type="checkbox" name="clearTexture"></div></div>
    <div class="form-group"><label>${t("F3D.WallConfig.Height")}</label>
      <div class="form-fields"><select name="preset">${presets}</select>
      <input type="number" name="custom" step="0.05" min="0.05" placeholder="${t("F3D.WallTools.Squares")}"></div></div>`;
  const read = (form) => ({
    texture: form.elements.texture?.value ?? "",
    doorTexture: form.elements.doorTexture?.value ?? "",
    fit: form.elements.fit?.value ?? "",
    scale: form.elements.scale?.value ?? "",
    clearTexture: !!form.elements.clearTexture?.checked,
    preset: form.elements.preset?.value ?? "keep",
    custom: form.elements.custom?.value ?? "",
  });
  let values = null;
  if (DialogV2) {
    values = await DialogV2.wait({
      window: { title: t("F3D.WallTools.Title") },
      content,
      buttons: [
        { action: "apply", label: t("F3D.WallTools.Apply"), default: true, callback: (ev, button) => read(button.form) },
        { action: "cancel", label: t("Cancel") },
      ],
      rejectClose: false,
    }).catch(() => null);
  }
  if (!values || values === "cancel") return;
  const updates = walls.map((w) => bulkWallUpdate(w.document.id, values, Number(w.document.door) > 0));
  await canvas.scene.updateEmbeddedDocuments("Wall", updates);
  ui.notifications.info(game.i18n.format("F3D.WallTools.Done", { n: updates.length }));
}
