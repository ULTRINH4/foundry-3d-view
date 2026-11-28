/**
 * The texture library picker: a "Library" button next to texture fields opens a window of
 * thumbnails; picking one fills the field with its "f3d:..." path. One delegated click handler
 * serves every sheet and dialog that renders `libraryButton(...)`.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { libraryOf, libraryEntry } from "../core/library.mjs";
import { libraryThumbnail } from "../render/texture-library.mjs";

const t = (k) => game.i18n.localize(k);

/** HTML for a Library button that fills the field named `target` with a texture of `kind`. */
export function libraryButton(target, kind) {
  return `<button type="button" class="f3d-lib-btn" data-target="${target}" data-kind="${kind}" data-tooltip="${t("F3D.Library.Open")}" title="${t("F3D.Library.Open")}"><i class="fa-solid fa-swatchbook"></i></button>`;
}

/** Localized name of a library texture path (for previews/labels). */
export function libraryName(src) {
  const e = libraryEntry(src);
  return e ? t(`F3D.Library.${e.name}`) : src;
}

/** Set a form field (input or <file-picker>) and let the form know. */
function setField(el, value) {
  el.value = value;
  const inner = el.querySelector?.("input");
  if (inner) inner.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Open the picker. Resolves with the chosen "f3d:..." path, or null.
 * @param {"wall"|"door"|"window"|"glass"} kind
 */
export function pickLibraryTexture(kind) {
  return new Promise((resolve) => {
    const items = libraryOf(kind).map((e) => `
      <button type="button" class="f3d-lib-item" data-src="f3d:${e.id}">
        <img src="${libraryThumbnail(`f3d:${e.id}`)}" alt="">
        <span>${t(`F3D.Library.${e.name}`)}</span>
      </button>`).join("");
    const content = `<div class="f3d-lib-grid">${items}</div>`;
    const DialogV2 = foundry.applications?.api?.DialogV2;
    let done = false;
    const finish = (v, dialog) => {
      if (done) return;
      done = true;
      resolve(v);
      if (dialog?.rendered) dialog.close();
    };
    const dialog = new DialogV2({
      window: { title: t(`F3D.Library.Title.${kind}`), resizable: true },
      position: { width: 560 },
      content,
      buttons: [{ action: "cancel", label: t("Cancel"), default: true }],
      submit: () => finish(null, null),
    });
    dialog.addEventListener?.("close", () => finish(null, null));
    dialog.render(true).then(() => {
      const root = dialog.element;
      root.classList.add("f3d-lib-dialog");
      root.querySelectorAll(".f3d-lib-item").forEach((b) => b.addEventListener("click", () => finish(b.dataset.src, dialog)));
    });
  });
}

let installed = false;
/** Install the delegated click handler for Library buttons (once). */
export function installLibraryButtons() {
  if (installed) return;
  installed = true;
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest?.(".f3d-lib-btn");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const scope = btn.closest("form, dialog, .application, .window-app") ?? document;
    const field = scope.querySelector(`[name="${btn.dataset.target}"]`);
    const src = await pickLibraryTexture(btn.dataset.kind);
    if (src && field) setField(field, src);
  }, true);
}

/** Library buttons in the module settings, next to the texture settings. */
export function injectSettingsButtons(html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const [key, kind] of [["wallTexture", "wall"], ["doorTexture", "door"], ["windowTexture", "window"], ["glassTexture", "glass"]]) {
    const name = `${MODULE_ID}.${key}`;
    const field = root.querySelector(`[name="${name}"]`);
    if (!field || field.parentElement?.querySelector(".f3d-lib-btn")) continue;
    field.insertAdjacentHTML("afterend", libraryButton(name, kind));
  }
}
