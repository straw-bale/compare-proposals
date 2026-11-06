import { savesShared } from "./store";
import { esc } from "./table";

/** A small confirm dialog. Resolves true when the user accepts. Escape, the backdrop, or Cancel resolve false. */
export function confirmModal(opts: { title: string; body: string; confirm: string; danger?: boolean; single?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `
      <h2>${esc(opts.title)}</h2>
      <p>${esc(opts.body)}</p>
      <div class="modal-actions">
        ${opts.single ? "" : '<button class="btn" value="cancel">Cancel</button>'}
        <button class="btn primary ${opts.danger ? "danger" : ""}" value="ok">${esc(opts.confirm)}</button>
      </div>`;
    const done = (ok: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(ok);
    };
    dialog.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button");
      if (btn) done(btn.value === "ok");
      else if (e.target === dialog) done(false); // backdrop
    });
    dialog.addEventListener("cancel", (e) => (e.preventDefault(), done(false)));
    document.body.appendChild(dialog);
    dialog.showModal();
    (dialog.querySelector<HTMLButtonElement>('[value="cancel"]') ?? dialog.querySelector<HTMLButtonElement>('[value="ok"]'))?.focus();
  });
}

/** Same dialog with a single OK button, for errors. */
export async function noticeModal(title: string, body: string): Promise<void> {
  await confirmModal({ title, body, confirm: "OK", single: true });
}

/** Asks before permanently deleting a saved review or comparison. */
export function confirmDelete(what: string): Promise<boolean> {
  return confirmModal({
    title: `Delete this ${what}?`,
    body: savesShared()
      ? `It will be permanently removed from the database for everyone who uses this app. This can't be undone.`
      : `It will be permanently removed from this browser. This can't be undone.`,
    confirm: "Delete",
    danger: true,
  });
}

/**
 * Asks for one or more lines of text. Resolves the trimmed values in order, or null on Cancel / Escape / backdrop.
 * The confirm button stays disabled while a required field is empty.
 */
export function formModal(opts: {
  title: string;
  fields: { label: string; value: string; placeholder?: string; required?: boolean }[];
  confirm: string;
}): Promise<string[] | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `
      <form>
        <h2>${esc(opts.title)}</h2>
        ${opts.fields
          .map(
            (f) =>
              `<label class="modal-field"><span>${esc(f.label)}</span><input type="text" autocomplete="off" value="${esc(f.value)}" placeholder="${esc(f.placeholder ?? "")}" /></label>`,
          )
          .join("")}
        <div class="modal-actions">
          <button class="btn" type="button" value="cancel">Cancel</button>
          <button class="btn primary" type="submit">${esc(opts.confirm)}</button>
        </div>
      </form>`;
    const inputs = [...dialog.querySelectorAll("input")];
    const ok = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const valid = () => opts.fields.every((f, i) => !f.required || inputs[i].value.trim());
    const update = () => (ok.disabled = !valid());
    const done = (values: string[] | null) => {
      dialog.close();
      dialog.remove();
      resolve(values);
    };
    inputs.forEach((i) => i.addEventListener("input", update));
    update();
    dialog.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      if (valid()) done(inputs.map((i) => i.value.trim()));
    });
    dialog.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest('[value="cancel"]') || e.target === dialog) done(null);
    });
    dialog.addEventListener("cancel", (e) => (e.preventDefault(), done(null)));
    document.body.appendChild(dialog);
    dialog.showModal();
    inputs[0]?.focus();
  });
}

/** A delete confirm that only enables Delete once the user types `name` exactly (like GitHub's repo delete). */
export function confirmTyped(opts: { title: string; body: string; name: string; confirm: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `
      <form>
        <h2>${esc(opts.title)}</h2>
        <p>${esc(opts.body)}</p>
        <label class="modal-field"><span>Type <b>${esc(opts.name)}</b> to confirm</span><input type="text" autocomplete="off" spellcheck="false" /></label>
        <div class="modal-actions">
          <button class="btn" type="button" value="cancel">Cancel</button>
          <button class="btn primary danger" type="submit" disabled>${esc(opts.confirm)}</button>
        </div>
      </form>`;
    const input = dialog.querySelector("input")!;
    const ok = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const matches = () => input.value.trim() === opts.name.trim();
    const done = (value: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    input.addEventListener("input", () => (ok.disabled = !matches()));
    dialog.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      if (matches()) done(true);
    });
    dialog.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest('[value="cancel"]') || e.target === dialog) done(false);
    });
    dialog.addEventListener("cancel", (e) => (e.preventDefault(), done(false)));
    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus();
  });
}
