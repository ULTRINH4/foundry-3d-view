/**
 * "3D view" section in the Scene configuration sheet: an ambience theme (one click sets walls,
 * doors, window frames, glass, sky colour and dust for this scene) and each pick on its own.
 * Stored in flags.foundry-3d-view.style; empty fields fall back to the theme, then the world.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { THEME_LIST } from "../core/library.mjs";
import { libraryButton } from "./library-picker.mjs";

const t = (k) => game.i18n.localize(k);
const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const F = (k) => `flags.${MODULE_ID}.style.${k}`;

function textureField(name, value, kind) {
  const input = customElements.get("file-picker")
    ? `<file-picker name="${name}" type="image" value="${esc(value)}"></file-picker>`
    : `<input type="text" name="${name}" value="${esc(value)}">`;
  return `${input}${libraryButton(name, kind)}`;
}

export function injectSceneConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = app.document ?? app.object;
  if (!root || !doc || root.querySelector(".f3d-scene-style")) return;
  const style = doc.getFlag(MODULE_ID, "style") ?? {};
  const themes = [["", t("F3D.Scene.NoTheme")], ...THEME_LIST.map((k) => [k, t(`F3D.Theme.${k}`)])]
    .map(([v, l]) => `<option value="${v}"${(style.theme ?? "") === v ? " selected" : ""}>${esc(l)}</option>`).join("");
  const dust = [["", t("F3D.Scene.DustTheme")], ["true", t("F3D.Scene.DustOn")], ["false", t("F3D.Scene.DustOff")]]
    .map(([v, l]) => `<option value="${v}"${String(style.dust ?? "") === v ? " selected" : ""}>${esc(l)}</option>`).join("");
  const row = (label, field, hint = "") => `
    <div class="form-group"><label>${label}</label><div class="form-fields">${field}</div>${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "f3d-scene-style";
  fieldset.innerHTML = `
    <legend>${t("F3D.Scene.Legend")}</legend>
    ${row(t("F3D.Scene.Theme"), `<select name="${F("theme")}">${themes}</select>`, t("F3D.Scene.ThemeHint"))}
    ${row(t("F3D.Settings.WallTexture.Name"), textureField(F("wallTexture"), style.wallTexture ?? "", "wall"))}
    ${row(t("F3D.Settings.DoorTexture.Name"), textureField(F("doorTexture"), style.doorTexture ?? "", "door"))}
    ${row(t("F3D.Settings.WindowTexture.Name"), textureField(F("windowTexture"), style.windowTexture ?? "", "window"))}
    ${row(t("F3D.Settings.GlassTexture.Name"), textureField(F("glassTexture"), style.glassTexture ?? "", "glass"))}
    ${row(t("F3D.Scene.Sky"), `<input type="text" name="${F("sky")}" value="${esc(style.sky ?? "")}" placeholder="#0a0c14">`, t("F3D.Scene.SkyHint"))}
    ${row(t("F3D.Scene.Dust"), `<select name="${F("dust")}" data-dtype="String">${dust}</select>`)}
    <p class="hint">${t("F3D.Scene.Hint")}</p>`;
  const form = root.tagName === "FORM" ? root : root.querySelector("form") ?? root;
  // v13/v14: put it in the "Ambience" (or "Basics") tab; older sheets: before the footer.
  const tab = form.querySelector('.tab[data-tab="ambience"], .tab[data-tab="environment"], .tab[data-tab="basics"], .tab[data-tab="basic"]');
  if (tab) tab.appendChild(fieldset);
  else {
    const footer = form.querySelector("footer, .form-footer, .sheet-footer");
    if (footer?.parentElement) footer.parentElement.insertBefore(fieldset, footer);
    else form.appendChild(fieldset);
  }
}

/** Normalize the stored style (select values are strings). */
export function sceneStyleFlags(scene) {
  const s = { ...(scene?.getFlag?.(MODULE_ID, "style") ?? {}) };
  if (s.dust === "true") s.dust = true;
  else if (s.dust === "false") s.dust = false;
  else if (typeof s.dust !== "boolean") delete s.dust;
  return s;
}
