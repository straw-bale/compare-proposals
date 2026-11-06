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
