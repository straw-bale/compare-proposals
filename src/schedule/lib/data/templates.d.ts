export type ScheduleTemplate = { key: string; label: string; make: () => Record<string, unknown> & { id: string; tasks: { id: number }[] } };
export const SCHEDULE_TEMPLATES: ScheduleTemplate[];
