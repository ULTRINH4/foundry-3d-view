/**
 * Adds a "3D texture" image field to Foundry's Wall configuration sheet. The value is stored in
 * the wall flag `flags.foundry-3d-view.texture` and overrides the module's wall look for that wall.
 * Works with v13 ApplicationV2 sheets (html is an HTMLElement, <file-picker> element) and falls
 * back to a plain text input on older sheets (html is jQuery).
 */
import { MODULE_ID } from "../core/constants.mjs";

const FIELD = `flags.${MODULE_ID}.texture`;

export function injectWallConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = app.document ?? app.object;
  if (!root || !doc || root.querySelector(`[name="${FIELD}"]`)) return;
  const t = (k) => game.i18n.localize(k);
  const value = foundry.utils.escapeHTML?.(doc.getFlag(MODULE_ID, "texture") ?? "") ?? (doc.getFlag(MODULE_ID, "texture") ?? "");
  const hasPicker = !!customElements.get("file-picker");
  const group = document.createElement("div");
  group.className = "form-group f3d-wall-texture";
  group.innerHTML = `
    <label>${t("F3D.WallConfig.Texture")}</label>
    <div class="form-fields">
      ${hasPicker
        ? `<file-picker name="${FIELD}" type="image" value="${value}"></file-picker>`
        : `<input type="text" name="${FIELD}" value="${value}" placeholder="path/to/texture.webp">`}
    </div>
    <p class="hint">${t("F3D.WallConfig.TextureHint")}</p>`;
  // v14 wraps the body in a scrollable .standard-form: append inside it. v13: before the footer.
  const form = root.tagName === "FORM" ? root : root.querySelector("form") ?? root;
  const body = form.querySelector(".standard-form.scrollable, .scrollable");
  if (body) {
    body.appendChild(group);
  } else {
    const footer = form.querySelector("footer, .form-footer, .sheet-footer, button[type=submit]");
    const anchor = footer?.closest?.("footer, .form-footer, .sheet-footer") ?? footer;
    if (anchor?.parentElement) anchor.parentElement.insertBefore(group, anchor);
    else form.appendChild(group);
  }
  if (typeof app.setPosition === "function") app.setPosition({ height: "auto" });
}
