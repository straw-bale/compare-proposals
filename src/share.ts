/** Copies a link that opens this saved review or comparison. The person opening it still needs the access code. */
export async function copyShareLink(tab: "rfp" | "proposals", id: string, button: HTMLElement) {
  const url = `${location.origin}${location.pathname}#${tab}/${encodeURIComponent(id)}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt("Copy this link:", url); // clipboard blocked (e.g. non-HTTPS page)
    return;
  }
  const label = button.textContent;
  button.textContent = "Link copied";
  setTimeout(() => (button.textContent = label), 1500);
}

/** "#rfp/<id>" → { tab: "rfp", id }. */
export function parseHash(): { tab: string; id: string | null } {
  const [tab, id] = location.hash.slice(1).split("/");
  return { tab: tab ?? "", id: id ? decodeURIComponent(id) : null };
}
