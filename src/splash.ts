// The splash line types itself out the first time the splash page shows. Every letter is laid out from the start
// (just invisible), so nothing on the page moves while it types. Reduced motion shows it all at once, and screen
// readers always get the whole phrase.

let typed = false;

export function typeSplash() {
  const h = document.getElementById("splash-line");
  if (!h || typed) return;
  typed = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const lines = h.innerHTML.split(/<br\s*\/?>/i).map((l) => l.trim());
  h.setAttribute("aria-label", lines.join(" "));
  h.innerHTML = lines
    .map((line) => `<span aria-hidden="true">${[...line].map((c) => `<span class="tw">${c}</span>`).join("")}</span>`)
    .join("<br />");
  const chars = [...h.querySelectorAll<HTMLElement>(".tw")];
  const caret = document.createElement("span");
  caret.className = "tw-caret";
  caret.setAttribute("aria-hidden", "true");
  chars[0]?.before(caret);
  let i = 0;
  const step = () => {
    const c = chars[i++];
    if (!c) return; // the cursor stays, blinking
    // A short pause at the end of each word, as if someone were typing it.
    const endOfWord = !c.nextElementSibling;
    c.classList.add("on");
    c.after(caret);
    setTimeout(step, endOfWord ? 200 : 32 + Math.random() * 28);
  };
  setTimeout(step, 250);
}
