import { writable } from 'svelte/store';
import { listSchedules, saveSchedule, deleteSchedule } from '../../../store';
import { toWeekday } from '../utils/dates.js';

// The schedule editor's store (a "project" here is one schedule). Same interface as in the schedule maker;
// saving now goes through this app's database (/api/db, behind the access code) instead of Supabase in the browser.

const { subscribe, update, set } = writable([]);

// Undo history: Map<projectId, snapshot[]>, capped at 50 entries per project.
const HISTORY_LIMIT = 50;
const _history = new Map();
const { subscribe: subscribeHistoryDepth, update: updateHistoryDepth } = writable({});

function _pushHistory(projectId, project) {
  const stack = _history.get(projectId) ?? [];
  stack.push(JSON.parse(JSON.stringify(project)));
  if (stack.length > HISTORY_LIMIT) stack.shift();
  _history.set(projectId, stack);
  updateHistoryDepth(d => ({ ...d, [projectId]: stack.length }));
}

function _popHistory(projectId) {
  const stack = _history.get(projectId) ?? [];
  if (!stack.length) return null;
  const snapshot = stack.pop();
  _history.set(projectId, stack);
  updateHistoryDepth(d => ({ ...d, [projectId]: stack.length }));
  return snapshot;
}

/** Forgets undo history (when leaving a schedule), so Undo never reaches into another visit. */
export function clearHistory(projectId) {
  _history.delete(projectId);
  updateHistoryDepth(d => ({ ...d, [projectId]: 0 }));
}

export const historyDepth = { subscribe: subscribeHistoryDepth };

// ── Saving ──
// Debounced (coalesces rapid updates, e.g. dragging bars), one request per schedule at a time so saves
// can't land out of order, and flushed when leaving the schedule or closing the page.
const DEBOUNCE_MS = 800;
const _timers = new Map();   // id → timeout
const _pending = new Map();  // id → latest unsaved version
const _inFlight = new Map(); // id → promise of the save in progress

export const saveError = writable('');

function _saveProject(project) {
  _pending.set(project.id, project);
  clearTimeout(_timers.get(project.id));
  _timers.set(project.id, setTimeout(() => _send(project.id), DEBOUNCE_MS));
}

async function _send(id, keepalive = false) {
  clearTimeout(_timers.get(id));
  _timers.delete(id);
  // Wait for the previous save of this schedule, then send whatever is newest by then.
  while (_inFlight.has(id)) await _inFlight.get(id);
  const project = _pending.get(id);
  if (!project) return;
  _pending.delete(id);
  const p = saveSchedule({ ...project, savedAt: Date.now() }, keepalive)
    .then(() => saveError.set(''))
    .catch(err => {
      console.error('[schedules] save failed:', err.message);
      saveError.set(`Not saved: ${err.message}`);
      if (!_pending.has(id)) _pending.set(id, project); // keep it for the next try
    })
    .finally(() => _inFlight.delete(id));
  _inFlight.set(id, p);
  await p;
}

/** Sends every unsaved change now. keepalive lets the requests finish if the page is closing. */
export function flushSaves(keepalive = false) {
  return Promise.all([..._pending.keys()].map(id => _send(id, keepalive)));
}

async function _deleteProject(id) {
  _pending.delete(id);
  clearTimeout(_timers.get(id));
  try {
    await deleteSchedule(id);
  } catch (err) {
    console.error('[schedules] delete failed:', err.message);
  }
}

// Point-in-time markers (milestones, deliverables, approvals, estimates) can't land on weekends.
function _weekdayDate(obj) {
  return obj?.date ? { ...obj, date: toWeekday(obj.date) } : obj;
}

// Brings previously saved projects up to the current color conventions:
//  - olive (#8B9A3A) was retired in favour of lime
//  - blue review bars (client / owner / design reviews, not permit/AHJ) moved to 50% gray
//    (runs once, so later picks stick)
const isReviewBar = t =>
  t.type === 'bar' && /review/i.test(t.name ?? '') && !/permit|ahj|regulatory/i.test(t.name ?? '') &&
  /^#(20ABE2|90D5F1)$/i.test(t.color ?? '');
export function normalizeProject(project) {
  const p = JSON.parse(JSON.stringify(project).replace(/#8B9A3A/gi, '#00914D'));
  if ((p.colorVersion ?? 1) < 2) {
    p.tasks = (p.tasks ?? []).map(t => isReviewBar(t) ? { ...t, color: '#949494' } : t);
    p.colorVersion = 2;
  }
  p.legend = _sortLegend(p.legend);
  return p;
}

// What the assistant may change on a task or legend item (never ids or links).
const TASK_FIELDS = ['name', 'type', 'color', 'start', 'end', 'date', 'msRef', 'note'];
const LEGEND_FIELDS = ['text', 'label', 'date', 'color', 'code'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Legend sections are always kept in ascending date order (undated items last).
const LEGEND_SECTIONS = ['deliverables', 'milestones', 'estimates', 'approvals'];
function _byDate(items) {
  return [...(items ?? [])].sort((a, b) =>
    !a.date ? (b.date ? 1 : 0) : !b.date ? -1 : a.date.localeCompare(b.date)
  );
}
function _sortLegend(legend) {
  if (!legend) return legend;
  const out = { ...legend };
  for (const k of LEGEND_SECTIONS) if (out[k]) out[k] = _byDate(out[k]);
  return out;
}

function _updateAndSave(projectId, fn) {
  let saved = null;
  update(ps => ps.map(p => {
    if (p.id !== projectId) return p;
    _pushHistory(projectId, p);
    saved = fn(p);
    return saved;
  }));
  if (saved) _saveProject(saved);
}

let _loaded = null;

export const projectStore = {
  subscribe,

  /** Loads every schedule once per visit (oldest first, as before). Unlike the old app, never inserts a sample. */
  init(force = false) {
    if (_loaded && !force) return _loaded;
    _loaded = listSchedules().then(rows => {
      const sorted = [...rows].sort((a, b) => (a.createdAt ?? a.savedAt ?? 0) - (b.createdAt ?? b.savedAt ?? 0));
      // Keep any in-memory edits that haven't been saved yet.
      set(sorted.map(r => _pending.get(r.id) ?? normalizeProject(r)));
    });
    return _loaded;
  },

  addProject(project) {
    project = { ...project, colorVersion: 2, legend: _sortLegend(project.legend), createdAt: Date.now() };
    update(ps => [...ps, project]);
    _saveProject(project);
    return project;
  },

  deleteProject(id) {
    update(ps => ps.filter(p => p.id !== id));
    _deleteProject(id);
  },

  updateProject(id, patch) {
    // A schedule's id and project link never change through an edit.
    const { id: _id, workspaceProjectId: _link, ...safe } = patch ?? {};
    _updateAndSave(id, p => ({ ...p, ...safe }));
  },

  /**
   * Applies the assistant's changes as one edit (one Undo reverses the whole reply), checking each first: the view
   * can only move its date range, tasks keep their ids, new tasks always get an unused id, and legend changes must
   * name a real section and item. Anything else in a change is ignored.
   */
  applyChanges(projectId, changes) {
    if (!Array.isArray(changes) || !changes.length) return;
    _updateAndSave(projectId, p => {
      let next = { ...p, tasks: [...(p.tasks ?? [])], legend: { ...(p.legend ?? {}) } };
      const pick = (obj, keys) => Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => keys.includes(k)));
      for (const c of changes) {
        if (c?.type === 'updateView') {
          const v = pick(c.patch, ['viewStart', 'viewEnd']);
          for (const k of Object.keys(v)) if (!ISO.test(v[k])) delete v[k];
          next = { ...next, ...v };
        } else if (c?.type === 'updateTask') {
          const patch = _weekdayDate(pick(c.patch, TASK_FIELDS));
          next.tasks = next.tasks.map(t => (t.id === c.taskId ? { ...t, ...patch } : t));
        } else if (c?.type === 'addTask' && c.task) {
          const used = new Set(next.tasks.map(t => t.id));
          const nextId = Math.max(0, ...used, (next.nextTaskId ?? 1) - 1) + 1;
          const task = _weekdayDate({ ...pick(c.task, TASK_FIELDS), id: used.has(c.task.id) || typeof c.task.id !== 'number' ? nextId : c.task.id });
          const at = c.insertAfterId != null ? next.tasks.findIndex(t => t.id === c.insertAfterId) : -1;
          if (at !== -1) next.tasks.splice(at + 1, 0, task);
          else next.tasks.push(task);
          next.nextTaskId = Math.max(...next.tasks.map(t => t.id)) + 1;
        } else if (c?.type === 'deleteTask') {
          next.tasks = next.tasks.filter(t => t.id !== c.taskId);
        } else if (c?.type === 'updateLegendItem' && LEGEND_SECTIONS.includes(c.section)) {
          const items = next.legend[c.section] ?? [];
          if (!Number.isInteger(c.index) || !items[c.index]) continue;
          const patch = _weekdayDate(pick(c.patch, LEGEND_FIELDS));
          next.legend[c.section] = _byDate(items.map((it, i) => (i === c.index ? { ...it, ...patch } : it)));
        }
      }
      return next;
    });
  },

  updateTask(projectId, taskId, patch) {
    _updateAndSave(projectId, p => ({
      ...p,
      tasks: p.tasks.map(t => t.id === taskId ? { ...t, ..._weekdayDate(patch) } : t),
    }));
  },

  addTask(projectId, task, insertAfterId = null) {
    _updateAndSave(projectId, p => {
      const tasks = [...p.tasks];
      task = _weekdayDate(task);
      // Never two tasks with the same id (older schedules' nextTaskId can lag behind their tasks).
      const used = new Set(tasks.map(t => t.id));
      if (used.has(task.id)) task = { ...task, id: Math.max(0, ...used) + 1 };
      const idx = insertAfterId != null ? tasks.findIndex(t => t.id === insertAfterId) : -1;
      if (idx !== -1) tasks.splice(idx + 1, 0, task);
      else tasks.push(task);
      return { ...p, tasks, nextTaskId: Math.max((p.nextTaskId || 1) + 1, ...tasks.map(t => t.id + 1)) };
    });
  },

  deleteTask(projectId, taskId) {
    _updateAndSave(projectId, p => ({
      ...p,
      tasks: p.tasks.filter(t => t.id !== taskId),
    }));
  },

  reorderTasks(projectId, fromIdx, toIdx) {
    _updateAndSave(projectId, p => {
      const tasks = [...p.tasks];
      const [task] = tasks.splice(fromIdx, 1);
      tasks.splice(toIdx, 0, task);
      return { ...p, tasks };
    });
  },

  updateLegendItem(projectId, section, idx, patch) {
    _updateAndSave(projectId, p => {
      const items = (p.legend[section] ?? []).map((item, i) =>
        i === idx ? { ...item, ..._weekdayDate(patch) } : item
      );
      return { ...p, legend: { ...p.legend, [section]: _byDate(items) } };
    });
  },

  undo(projectId) {
    const snapshot = _popHistory(projectId);
    if (!snapshot) return;
    update(ps => ps.map(p => p.id === projectId ? snapshot : p));
    _saveProject(snapshot);
  },

  updateLegendSection(projectId, section, items) {
    items = _byDate(items.map(_weekdayDate));
    _updateAndSave(projectId, p => {
      let tasks = p.tasks;
      if (section === 'milestones') {
        tasks = p.tasks.map(t => {
          if (!t.msRef) return t;
          const m = items.find(m => m.code === t.msRef.code);
          return m ? { ...t, msRef: { code: m.code, color: m.color } } : t;
        });
      }
      return { ...p, legend: { ...p.legend, [section]: items }, tasks };
    });
  },
};
