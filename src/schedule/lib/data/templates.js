import { createBlankProject, createSmallTemplate, createMediumTemplate, createLargeTemplate } from './sample.js';

// The starting points for a new schedule, shared by the Schedule tab and the project page.
export const SCHEDULE_TEMPLATES = [
  { key: 'blank', label: 'Blank (an empty timeline)', make: createBlankProject },
  { key: 'small', label: 'Small: renovation or fit-out (about 12 months, 14 tasks)', make: createSmallTemplate },
  { key: 'medium', label: 'Medium: commercial or institutional (about 23 months, 17 tasks)', make: createMediumTemplate },
  { key: 'large', label: 'Large: complex, with permitting (about 36 months, 21 tasks)', make: createLargeTemplate },
];
