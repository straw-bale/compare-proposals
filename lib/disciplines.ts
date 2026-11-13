// The governing list of consultant disciplines, in display order. Shared by server and browser.
// Everything that groups or labels consultants by discipline uses these exact names.

export const DISCIPLINES = [
  "Architecture",
  "Interiors",
  "FF&E",
  "Hazardous Materials",
  "Geotechnical",
  "Civil",
  "Landscape",
  "Structural",
  "Laboratory Design",
  "Food Service",
  "Fire Protection",
  "Plumbing",
  "Mechanical",
  "Electrical",
  "Cost Estimating",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

// Words that mean each discipline in proposals and RFPs. Checked case-insensitively against free text.
const MATCHERS: [Discipline, RegExp][] = [
  // "Architectural acoustics" or "landscape architecture" isn't Architecture.
  ["Architecture", /^(?!.*\b(acoustic|lighting|landscape)).*\barchitect/i],
  ["Interiors", /\binterior/i],
  ["FF&E", /ff\s*&\s*e|\bffe\b|furniture|furnishings/i],
  ["Hazardous Materials", /hazard|haz[\s-]?mat|abatement|asbestos|lead[\s-]based|environmental (survey|assessment)/i],
  ["Geotechnical", /geotech|soils?\b|subsurface|boring/i],
  ["Civil", /\bcivil\b|site engineering|stormwater|grading|site utilit/i],
  ["Landscape", /landscape/i],
  ["Structural", /structur|\bstruct\b/i],
  ["Laboratory Design", /\blab(oratory)?s?\b.*(plan|design|consult)|(plan|design).*\blab(oratory)?s?\b|^lab(oratory)?s?$/i],
  // Food service consulting: commercial kitchens and servery design, not a break-room kitchenette.
  ["Food Service", /food[\s-]?service|foodservice|commercial kitchen|kitchen (equipment|design|consult)|culinary|servery|cafeteria|dining (hall|services)/i],
  ["Fire Protection", /fire[\s-]?(protection|suppression|alarm)|sprinkler|\bmepfp\b/i],
  ["Plumbing", /plumbing|\bmep\b|\bmepf?p?\b|domestic water|sanitary/i],
  ["Mechanical", /mechanical|\bmep\b|\bmepf?p?\b|hvac|\bm\/e\/p\b/i],
  ["Electrical", /electrical|\bmep\b|\bmepf?p?\b|power|lighting design|low[\s-]?voltage/i],
  ["Cost Estimating", /cost estimat|\bestimat|cost consult|quantity survey/i],
];

/** Maps free-text disciplines ("MEP", "HVAC design", "Lab planning") onto the governing list, in list order. */
export function toDisciplines(texts: string[]): Discipline[] {
  const hits = new Set<Discipline>();
  for (const t of texts) for (const [d, re] of MATCHERS) if (re.test(t)) hits.add(d);
  return DISCIPLINES.filter((d) => hits.has(d));
}
