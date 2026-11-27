/**
 * Foundry 3D View fields in the Tile configuration sheet: draw this tile as a 3D model (a built-in
 * low-poly prop or a custom .glb/.gltf file) filling the tile's footprint. Plus a Tiles controls
 * tool that exports the built-in models as .glb files into the data folder.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { BUILTIN_MODEL_IDS, exportBuiltinModels } from "../render/models.mjs";

const F = `flags.${MODULE_ID}`;
const t = (k) => game.i18n.localize(k);
const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

export function injectTileConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = app.document ?? app.object;
  if (!root || !doc || root.querySelector(`[name="${F}.model"]`)) return;
  const flags = doc.flags?.[MODULE_ID] ?? {};
  const opts = ["", ...BUILTIN_MODEL_IDS]
    .map((id) => `<option value="${id}" ${flags.model === id ? "selected" : ""}>${id ? t(`F3D.Models.${id}`) : t("F3D.TileConfig.None")}</option>`).join("");
  const picker = customElements.get("file-picker")
    ? `<file-picker name="${F}.modelFile" type="any" value="${esc(flags.modelFile)}"></file-picker>`
    : `<input type="text" name="${F}.modelFile" value="${esc(flags.modelFile)}" placeholder="models/thing.glb">`;
  const fs = document.createElement("fieldset");
  fs.className = "f3d-tile-model";
  fs.innerHTML = `
    <legend>${t("F3D.TileConfig.Legend")}</legend>
    <div class="form-group"><label>${t("F3D.TileConfig.Model")}</label><div class="form-fields"><select name="${F}.model">${opts}</select></div></div>
    <div class="form-group"><label>${t("F3D.TileConfig.ModelFile")}</label><div class="form-fields">${picker}</div>
      <p class="hint">${t("F3D.TileConfig.ModelFileHint")}</p></div>
    <div class="form-group"><label>${t("F3D.TileConfig.ModelHeight")}</label><div class="form-fields">
      <input type="number" name="${F}.modelHeight" min="0.1" step="0.1" value="${esc(flags.modelHeight ?? 1)}"></div></div>`;
  const tab = root.querySelector('.tab[data-tab="appearance"]') ?? root.querySelector(".tab.active") ?? root.querySelector(".standard-form.scrollable") ?? root.querySelector("form") ?? root;
  tab.appendChild(fs);
  if (typeof app.setPosition === "function") app.setPosition({ height: "auto" });
}

/** Export the built-in models as .glb files to `foundry-3d-view-models/` (GM). */
export async function exportModelsToData() {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const dir = "foundry-3d-view-models";
  try {
    await FP.createDirectory("data", dir);
  } catch {
    /* already there */
  }
  const files = await exportBuiltinModels();
  for (const [id, bytes] of Object.entries(files)) {
    const file = new File([bytes], `${id}.glb`, { type: "model/gltf-binary" });
    await FP.upload("data", dir, file, {}, { notify: false });
  }
  ui.notifications.info(game.i18n.format("F3D.TileConfig.Exported", { n: Object.keys(files).length, dir }));
  return Object.keys(files).map((id) => `${dir}/${id}.glb`);
}
