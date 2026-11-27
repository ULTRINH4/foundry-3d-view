/**
 * "Foundry 3D View" fields in the Token configuration sheet (token and prototype token):
 * a directional / animated sprite sheet used by the 3D view instead of the token image.
 * Stored in flags.foundry-3d-view.sheet = { src, directions, frames, fps }.
 */
import { MODULE_ID } from "../core/constants.mjs";

const P = `flags.${MODULE_ID}.sheet`;
const t = (k) => game.i18n.localize(k);
const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

export function injectTokenConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = app.document ?? app.token ?? app.object;
  if (!root || !doc || root.querySelector(`[name="${P}.src"]`)) return;
  const sheet = foundry.utils.getProperty(doc, P) ?? doc.flags?.[MODULE_ID]?.sheet ?? {};
  const picker = customElements.get("file-picker")
    ? `<file-picker name="${P}.src" type="imagevideo" value="${esc(sheet.src)}"></file-picker>`
    : `<input type="text" name="${P}.src" value="${esc(sheet.src)}">`;
  const opt = (v) => `<option value="${v}" ${Number(sheet.directions ?? 1) === v ? "selected" : ""}>${v}</option>`;
  const fs = document.createElement("fieldset");
  fs.className = "f3d-token-sheet";
  fs.innerHTML = `
    <legend>${t("F3D.TokenConfig.Legend")}</legend>
    <p class="hint">${t("F3D.TokenConfig.Hint")}</p>
    <div class="form-group"><label>${t("F3D.TokenConfig.Sheet")}</label><div class="form-fields">${picker}</div></div>
    <div class="form-group"><label>${t("F3D.TokenConfig.Directions")}</label>
      <div class="form-fields"><select name="${P}.directions" data-dtype="Number">${opt(1)}${opt(4)}${opt(8)}</select></div></div>
    <div class="form-group"><label>${t("F3D.TokenConfig.Frames")}</label>
      <div class="form-fields"><input type="number" name="${P}.frames" min="1" step="1" value="${esc(sheet.frames ?? 1)}"></div></div>
    <div class="form-group"><label>${t("F3D.TokenConfig.Fps")}</label>
      <div class="form-fields"><input type="number" name="${P}.fps" min="0" step="1" value="${esc(sheet.fps ?? 8)}"></div></div>
    <div class="form-group"><label>${t("F3D.TokenConfig.MoveRange")}</label>
      <div class="form-fields"><input type="number" name="flags.${MODULE_ID}.moveRange" min="1" step="1" placeholder="${t("F3D.WallConfig.HeightDefault")}" value="${esc(doc.flags?.[MODULE_ID]?.moveRange ?? "")}"></div></div>
    <div class="form-group"><label>${t("F3D.TokenConfig.AttackRange")}</label>
      <div class="form-fields"><input type="number" name="flags.${MODULE_ID}.attackRange" min="0" step="1" placeholder="${t("F3D.WallConfig.HeightDefault")}" value="${esc(doc.flags?.[MODULE_ID]?.attackRange ?? "")}"></div></div>`;
  // Prefer the Appearance tab (v13/v14 TokenConfig); otherwise the end of the form body.
  const tab = root.querySelector('.tab[data-tab="appearance"]') ?? root.querySelector(".tab.active") ?? root.querySelector("form") ?? root;
  tab.appendChild(fs);
}
