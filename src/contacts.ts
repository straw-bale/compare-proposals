// A consultant's contacts: one per person, with name, role, email and phone kept apart.

export type Contact = { name: string; role: string; email: string; phone: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// "(412) 787-0720", "412-371-4460 x122", "412.321.3951 ext. 406", optionally labeled ("cell 919-623-3011").
const PHONE = /(?:\b(?:office|cell|mobile|direct|phone|tel|fax|[ocmdpf])\b[:.]?\s*)?(?:\(\d{3}\)\s*|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi;

/**
 * Splits contact text written as one line per person ("Name (Role), email, phone; next person…") into fields.
 * Used for contacts saved before the fields existed and for contacts read from proposals.
 */
export function parseContacts(text?: string | null): Contact[] {
  if (!text) return [];
  return text
    .split(";")
    .map((part) => {
      const email = (part.match(EMAIL) ?? [])[0] ?? "";
      const phone = (part.replace(EMAIL, "").match(PHONE) ?? []).map((p) => p.trim()).join(", ");
      let rest = part.replace(EMAIL, "").replace(PHONE, "");
      const role = /\(([^)]*)\)/.exec(rest)?.[1]?.trim() ?? "";
      rest = rest.replace(/\([^)]*\)/, "");
      const name = rest
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(", ");
      return { name, role, email, phone };
    })
    .filter((c) => c.name || c.email || c.phone);
}

export const contactText = (c: Contact) => [c.name, c.role, c.email, c.phone].join(" ");
