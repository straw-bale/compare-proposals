import { savesShared } from "./store";
import type { Contact } from "./contacts";
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
 * The confirm button stays disabled while a required field is empty. A field with `options` is a set of checkboxes;
 * its value in and out is the chosen options, one per line (option names may contain commas). With `single` they're
 * radio buttons instead: exactly one can be chosen, and its value is that option. A `contacts` field is
 * one row per person (name, role, email, phone) with add/remove; its value in and out is a JSON array of Contact.
 */
export function formModal(opts: {
  title: string;
  fields: { label: string; value: string; placeholder?: string; required?: boolean; options?: readonly string[]; single?: boolean; suggestions?: readonly string[]; contacts?: boolean }[];
  confirm: string;
  /** Extra check on the current values; the confirm button stays disabled until it passes. */
  validate?: (values: string[]) => boolean;
}): Promise<string[] | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `
      <form>
        <h2>${esc(opts.title)}</h2>
        ${opts.fields
          .map((f, i) => {
            if (f.contacts) {
              const rows = (JSON.parse(f.value || "[]") as Contact[]).map(contactRow).join("") || contactRow();
              return `<fieldset class="modal-field modal-contacts" data-field="${i}"><legend>${esc(f.label)}</legend><div class="contact-rows">${rows}</div><button type="button" class="link" data-add-contact>+ Add another contact</button></fieldset>`;
            }
            if (!f.options)
              return `<label class="modal-field"><span>${esc(f.label)}</span><input type="text" data-field="${i}" autocomplete="off" value="${esc(f.value)}" placeholder="${esc(f.placeholder ?? "")}" ${
                f.suggestions ? `list="modal-list-${i}"` : ""
              } /></label>${f.suggestions ? `<datalist id="modal-list-${i}">${f.suggestions.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>` : ""}`;
            const on = new Set(f.value.split("\n").map((v) => v.trim()));
            return `<fieldset class="modal-field modal-options" data-field="${i}"><legend>${esc(f.label)}</legend>${f.options
              .map((o) => `<label><input type="${f.single ? "radio" : "checkbox"}" ${f.single ? `name="modal-choice-${i}"` : ""} value="${esc(o)}" ${on.has(o) ? "checked" : ""} /> ${esc(o)}</label>`)
              .join("")}</fieldset>`;
          })
          .join("")}
        <div class="modal-actions">
          <button class="btn" type="button" value="cancel">Cancel</button>
          <button class="btn primary" type="submit">${esc(opts.confirm)}</button>
        </div>
      </form>`;
    const fieldEls = opts.fields.map((_, i) => dialog.querySelector<HTMLElement>(`[data-field="${i}"]`)!);
    const valueOf = (i: number) =>
      opts.fields[i].contacts
        ? JSON.stringify(readContacts(fieldEls[i]))
        : opts.fields[i].options
          ? [...fieldEls[i].querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value).join("\n")
          : (fieldEls[i] as HTMLInputElement).value.trim();
    const inputs = [...dialog.querySelectorAll("input")];
    const ok = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const valid = () =>
      opts.fields.every((f, i) => !f.required || valueOf(i)) && (!opts.validate || opts.validate(opts.fields.map((_, i) => valueOf(i))));
    const update = () => (ok.disabled = !valid());
    const done = (values: string[] | null) => {
      dialog.close();
      dialog.remove();
      resolve(values);
    };
    // Delegated, so contact rows added later are covered too.
    dialog.addEventListener("input", update);
    dialog.addEventListener("change", update);
    update();
    dialog.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      if (valid()) done(opts.fields.map((_, i) => valueOf(i)));
    });
    dialog.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[value="cancel"]') || e.target === dialog) return done(null);
      const add = t.closest("[data-add-contact]");
      if (add) {
        const rows = add.previousElementSibling!;
        rows.insertAdjacentHTML("beforeend", contactRow());
        rows.lastElementChild?.querySelector("input")?.focus();
      }
      const remove = t.closest(".contact-row");
      if (remove && t.closest("[data-remove-contact]")) {
        // The last row is cleared rather than removed, so there's always one to type in.
        if (remove.parentElement!.children.length > 1) remove.remove();
        else remove.querySelectorAll("input").forEach((i) => (i.value = ""));
        update();
      }
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

/** One contact's inputs in the form dialog. */
function contactRow(c: Partial<Contact> = {}): string {
  const input = (k: keyof Contact, type: string, placeholder: string, label: string) =>
    `<input type="${type}" data-c="${k}" value="${esc(c[k] ?? "")}" placeholder="${placeholder}" aria-label="${label}" autocomplete="off" />`;
  return `<div class="contact-row">
    ${input("name", "text", "Name", "Contact name")}${input("role", "text", "Role (optional)", "Role")}
    ${input("email", "email", "Email", "Email")}${input("phone", "tel", "Phone", "Phone")}
    <button type="button" class="link" data-remove-contact>Remove</button>
  </div>`;
}

/** The contacts typed into a contacts field, skipping empty rows. */
function readContacts(field: HTMLElement): Contact[] {
  return [...field.querySelectorAll(".contact-row")]
    .map((row) => {
      const v = (k: keyof Contact) => row.querySelector<HTMLInputElement>(`[data-c="${k}"]`)!.value.trim();
      return { name: v("name"), role: v("role"), email: v("email"), phone: v("phone") };
    })
    .filter((c) => c.name || c.email || c.phone);
}

/** Asks for a project's number and name. Resolves null on cancel. */
export async function askProjectName(title: string, confirm: string, p: { number?: string; name: string }) {
  const values = await formModal({
    title,
    fields: [
      { label: "Project number", value: p.number ?? "", placeholder: "Optional" },
      { label: "Project name", value: p.name, required: true },
    ],
    confirm,
  });
  return values && { number: values[0] || undefined, name: values[1] };
}
