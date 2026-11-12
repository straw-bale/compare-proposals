<script>
  import { projectStore, historyDepth, saveError } from '../lib/stores/projects.js';
  import { generateId, parseDate, toISO, MONTHS_SHORT, monthList, totalDays, ZOOM_COL_W, projectDateRange, pxToDateMonth, pxToDatePeriod, toWeekday } from '../lib/utils/dates.js';
  import TaskPanel    from '../lib/components/TaskPanel.svelte';
  import GanttPanel   from '../lib/components/GanttPanel.svelte';
  import LegendFooter from '../lib/components/LegendFooter.svelte';
  import AiSidebar    from '../lib/components/AiSidebar.svelte';
  import PrintPanel   from '../lib/components/PrintPanel.svelte';
  import { goto } from '../lib/nav.js';
  import { confirmDelete } from '../../modal';
  import { accessCode } from '../../api';
  import { pointerDrag } from '../lib/utils/pointer.js';

  let { data } = $props();
  // Back goes to the project this schedule belongs to, or to the schedule list.
  let markerLanes = $state(1); // stacked marker lanes reported by GanttPanel

  // Derive project from store reactively
  let allProjects = $state([]);
  projectStore.subscribe(v => { allProjects = v; });
  let project = $derived(allProjects.find(p => p.id === data.id) ?? null);

  // Deletes this schedule after the site's warning, then goes back to its project (or the schedule list).
  async function deleteSchedule() {
    if (!project) return;
    const back = project.workspaceProjectId ? `#project/${encodeURIComponent(project.workspaceProjectId)}` : '#schedule';
    if (!(await confirmDelete('schedule'))) return;
    projectStore.deleteProject(project.id);
    location.hash = back;
  }

  let historyState = $state({});
  historyDepth.subscribe(v => { historyState = v; });
  let canUndo = $derived((historyState[data.id] ?? 0) > 0);

  function handleUndo() {
    projectStore.undo(data.id);
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !document.querySelector('dialog[open]')) {
      if (document.activeElement?.isContentEditable ||
          document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      handleUndo();
    }
  }

  let aiOpen = $state(false);

  // Milestone drag-from-footer state
  let draggingLegendMs = $state(null);  // { code, color, text } while dragging
  let dropDate         = $state(null);  // ISO date string shown as drop indicator in Gantt
  let highlightTaskId  = $state(null);  // briefly highlights a Gantt row on click-to-link

  // Gantt geometry for date-from-x computation
  const MOBILE_W   = 640;
  let innerW       = $state(window.innerWidth);
  let isMobile     = $derived(innerW < MOBILE_W);
  let TASK_COL_W   = $derived(isMobile ? 140 : 252);
  let schW        = $state(0);
  let trueRange  = $derived(project ? projectDateRange(project.tasks) : { start: null, end: null });
  let trueStart  = $derived(trueRange.start);
  let trueEnd    = $derived(trueRange.end);

  let ganttMonths = $derived(project ? monthList(parseDate(project.viewStart), parseDate(project.viewEnd)) : []);
  let fitColW     = $derived(ganttMonths.length > 0 ? Math.max(20, Math.floor((schW - TASK_COL_W) / ganttMonths.length)) : 72);
  let printColW   = $state(null); // non-null during print: forces fit-to-paper column width
  let effectiveColW = $derived(
    printColW !== null ? printColW :
    zoom === 'fit' ? fitColW : (ZOOM_COL_W[zoom] ?? 72)
  );
  let ganttWidth  = $derived(ganttMonths.length * effectiveColW);
  let displayZoom = $derived(zoom === 'fit' ? 'month' : zoom);

  // Drop targets snap off weekends so the indicator shows the date that will be saved
  function xToDate(clientX) {
    const iso = xToRawDate(clientX);
    return iso && toWeekday(iso);
  }

  function xToRawDate(clientX) {
    if (!schScrollEl || !project) return null;
    const rect = schScrollEl.getBoundingClientRect();
    const relX  = clientX - rect.left - TASK_COL_W + schScrollEl.scrollLeft;
    const vs    = parseDate(project.viewStart);
    if (displayZoom === 'month')  return pxToDateMonth(relX, vs, effectiveColW);
    if (displayZoom === 'biweek') return pxToDatePeriod(relX, vs, effectiveColW, 14);
    if (displayZoom === 'week')   return pxToDatePeriod(relX, vs, effectiveColW, 7);
    // fallback (should not be reached with current zoom options)
    const ve = parseDate(project.viewEnd);
    const ms = vs.getTime() + (relX / ganttWidth) * (ve - vs);
    const d  = new Date(ms);
    return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  function isOverGantt(clientX, clientY) {
    if (!schScrollEl) return false;
    const r = schScrollEl.getBoundingClientRect();
    return clientX >= r.left + TASK_COL_W && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  // Shared drag engine: hold-and-drag OR click-to-attach (click again to drop).
  // If the pointer moves before release it's a standard drag; a quick click/tap switches to
  // sticky mode where the ghost follows the cursor until the next click/tap or Escape.
  // Legend chips have touch-action: none, so touch drags start immediately too.
  function startLegendDrag(ghost, e, onDrop) {
    const origin = e.currentTarget;
    let moved = false;

    function place(ev) {
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top  = ev.clientY + 'px';
      dropDate = isOverGantt(ev.clientX, ev.clientY) ? xToDate(ev.clientX) : null;
    }

    pointerDrag(e, {
      onStart() { document.body.appendChild(ghost); place(e); },
      onMove(ev) {
        place(ev);
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) moved = true;
      },
      onEnd(ev) {
        if (!moved) return startStickyDrag(ghost, ev.clientX, ev.clientY, onDrop, { origin });
        const date = isOverGantt(ev.clientX, ev.clientY) ? xToDate(ev.clientX) : null;
        ghost.remove();
        dropDate         = null;
        draggingLegendMs = null;
        if (date && project) onDrop(date);
      },
      holdMs: 0,
    });
  }

  const GHOST_CSS = `
    position:fixed; z-index:9999; pointer-events:none;
    display:flex; align-items:center; gap:6px;
    background:#fff; border:1px solid #ddd; border-radius:4px;
    padding:5px 10px; box-shadow:0 4px 14px rgba(0,0,0,.18);
    font-family:'Barlow Condensed',sans-serif; font-size:12px; font-weight:600;
    transform:translate(-50%,-50%);
  `;

  // Sticky drag: ghost follows the cursor, next click/tap places it (on the Gantt for
  // date-positioned items). Escape cancels. Dropping on 'click' (not press) means a
  // touch swipe can still scroll the schedule to find the spot first, and the click
  // that launched the drag is ignored via `origin`. For items with no Gantt position,
  // pass anyDrop: true.
  function startStickyDrag(ghost, x, y, onDrop, { anyDrop = false, origin = null } = {}) {
    ghost.style.left = x + 'px';
    ghost.style.top  = y + 'px';
    document.body.appendChild(ghost);

    function onMove(e) {
      if (e.pointerType === 'touch') return; // touch: ghost waits where it is until the tap
      ghost.style.left = e.clientX + 'px';
      ghost.style.top  = e.clientY + 'px';
      if (!anyDrop) dropDate = isOverGantt(e.clientX, e.clientY) ? xToDate(e.clientX) : null;
    }
    // Keep the placing press from also grabbing a bar/marker underneath it
    function onPress(e) { if (!origin?.contains(e.target)) e.stopPropagation(); }
    function cleanup() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('click',       onClick, true);
      document.removeEventListener('keydown',     onKey);
      ghost.remove();
      dropDate         = null;
      draggingLegendMs = null;
    }
    function onClick(e) {
      if (origin?.contains(e.target)) return;
      e.stopPropagation();
      // Read the date from the click itself — touch taps have no preceding hover moves
      const date = isOverGantt(e.clientX, e.clientY) ? xToDate(e.clientX) : null;
      cleanup();
      if (anyDrop || (date && project)) onDrop(date);
    }
    function onKey(e) { if (e.key === 'Escape') cleanup(); }

    document.addEventListener('pointermove', onMove);
    // RAF ensures these listeners are added after the launching click has fully propagated.
    requestAnimationFrame(() => {
      document.addEventListener('pointerdown', onPress, true);
      document.addEventListener('click',       onClick, true);
      document.addEventListener('keydown',     onKey);
    });
  }

  function makeMilestoneGhost(ms) {
    const g = document.createElement('div');
    g.style.cssText = GHOST_CSS;
    const dot = document.createElement('div');
    dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${ms.color};flex-shrink:0;`;
    g.appendChild(dot);
    g.appendChild(document.createTextNode(ms.text || ms.code));
    return g;
  }

  function makeDeliverableGhost(n) {
    const g = document.createElement('div');
    g.style.cssText = GHOST_CSS;
    const badge = document.createElement('div');
    badge.style.cssText = `width:18px;height:18px;border-radius:50%;background:#D4804A;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;`;
    badge.textContent = String(n);
    g.appendChild(badge);
    g.appendChild(document.createTextNode('New Deliverable'));
    return g;
  }

  function makeApprovalGhost(a) {
    const g = document.createElement('div');
    g.style.cssText = GHOST_CSS;
    const diamond = document.createElement('div');
    diamond.style.cssText = `width:10px;height:10px;background:#3B8FA0;transform:rotate(45deg);flex-shrink:0;`;
    g.appendChild(diamond);
    g.appendChild(document.createTextNode(a.text || 'New Approval'));
    return g;
  }

  function makeEstimateGhost(est) {
    const g = document.createElement('div');
    g.style.cssText = GHOST_CSS;
    const circle = document.createElement('div');
    circle.style.cssText = `width:18px;height:18px;border-radius:50%;background:${est.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;`;
    circle.textContent = est.code || 'E';
    g.appendChild(circle);
    g.appendChild(document.createTextNode(est.text));
    return g;
  }

  // Reposition an existing legend milestone by dragging its footer pill.
  function startMilestoneDrag(ms, e) {
    draggingLegendMs = ms;
    startLegendDrag(makeMilestoneGhost(ms), e, (date) => {
      const idx = project.legend.milestones.findIndex(m => m.code === ms.code);
      if (idx >= 0) projectStore.updateLegendItem(data.id, 'milestones', idx, { date });
    });
  }

  function startApprovalDrag(a, e) {
    startLegendDrag(makeApprovalGhost(a), e, (date) => {
      const idx = project.legend.approvals.findIndex(ap => ap.text === a.text);
      if (idx >= 0) projectStore.updateLegendItem(data.id, 'approvals', idx, { date });
    });
  }

  function startEstimateDrag(est, e) {
    startLegendDrag(makeEstimateGhost(est), e, (date) => {
      const idx = project.legend.estimates.findIndex(e => e.code === est.code);
      if (idx >= 0) projectStore.updateLegendItem(data.id, 'estimates', idx, { date });
    });
  }

  function handleAddMilestone(e) {
    if (!project) return;
    const n  = (project.legend.milestones?.length ?? 0) + 1;
    const ms = { code: `M${n}`, text: 'New Milestone', color: '#888888' };
    draggingLegendMs = ms;
    startStickyDrag(makeMilestoneGhost(ms), e.clientX, e.clientY, (date) => {
      projectStore.updateLegendSection(data.id, 'milestones', [
        ...(project.legend.milestones ?? []),
        { ...ms, date },
      ]);
    }, { origin: e.currentTarget });
  }

  function handleAddDeliverable(e) {
    if (!project) return;
    const n = (project.legend.deliverables?.length ?? 0) + 1;
    startStickyDrag(makeDeliverableGhost(n), e.clientX, e.clientY, (date) => {
      projectStore.updateLegendSection(data.id, 'deliverables', [
        ...(project.legend.deliverables ?? []),
        { text: 'New Deliverable', label: '', date },
      ]);
    }, { origin: e.currentTarget });
  }

  function handleAddApproval(e) {
    if (!project) return;
    const a = { text: 'New Approval' };
    startStickyDrag(makeApprovalGhost(a), e.clientX, e.clientY, (date) => {
      projectStore.updateLegendSection(data.id, 'approvals', [
        ...(project.legend.approvals ?? []),
        { ...a, date },
      ]);
    }, { origin: e.currentTarget });
  }

  function handleAddEstimate(e) {
    if (!project) return;
    const n   = (project.legend.estimates?.length ?? 0) + 1;
    const est = { code: `E${n}`, text: 'New Estimate', color: '#00914D' };
    startStickyDrag(makeEstimateGhost(est), e.clientX, e.clientY, (date) => {
      projectStore.updateLegendSection(data.id, 'estimates', [
        ...(project.legend.estimates ?? []),
        { ...est, date },
      ]);
    }, { origin: e.currentTarget });
  }

  function linkToGantt(msCode) {
    if (!project) return;
    const task = project.tasks.find(t => t.msRef?.code === msCode || t.delRef === msCode);
    if (!task) return;
    highlightTaskId = task.id;
    // Scroll the row into view (task panel list)
    const idx = project.tasks.indexOf(task);
    if (schScrollEl) schScrollEl.scrollTop = idx * 26;
    setTimeout(() => { highlightTaskId = null; }, 1800);
  }

  let schScrollEl = $state(null);

  // Store callbacks
  function handleTaskUpdate(taskId, patch) {
    projectStore.updateTask(data.id, taskId, patch);
  }
  function handleRename(taskId, name) {
    projectStore.updateTask(data.id, taskId, { name });
  }
  function handleDelete(taskId) {
    projectStore.deleteTask(data.id, taskId);
  }
  function handleReorder(fromIdx, toIdx) {
    projectStore.reorderTasks(data.id, fromIdx, toIdx);
  }
  function handleAdd() {
    if (!project) return;
    const vs  = parseDate(project.viewStart);
    const ve  = parseDate(project.viewEnd);
    const mid = new Date((vs.getTime() + ve.getTime()) / 2);
    const s   = new Date(mid.getFullYear(), mid.getMonth(), 1);
    const e   = new Date(mid.getFullYear(), mid.getMonth() + 1, 1);
    const task = {
      id:    (project.nextTaskId ?? Date.now()),
      name:  'New Task',
      type:  'bar',
      color: '#20ABE2',
      start: toISO(s),
      end:   toISO(e),
    };
    projectStore.addTask(data.id, task);
  }

  function updateMeta(field, val) {
    projectStore.updateProject(data.id, { [field]: val });
  }
  let titleEl    = $state(null);
  // Only push store value to DOM when element isn't focused — prevents double-render on blur.
  $effect(() => { if (titleEl    && document.activeElement !== titleEl)    titleEl.textContent    = project?.title    ?? ''; });

  function updateTitle(val) {
    projectStore.updateProject(data.id, { title: val });
  }

  function handleLegendUpdate(section, items) {
    projectStore.updateLegendSection(data.id, section, items);
  }

  // Called from GanttPanel when overlay milestone/deliverable is dragged to a new date
  function handleLegendItemUpdate(section, idx, patch) {
    projectStore.updateLegendItem(data.id, section, idx, patch);
  }

  // Gantt bar drag → highlight corresponding TaskPanel row
  let draggingTaskId = $state(null);
  function handleDraggingChange(id) { draggingTaskId = id; }

  let reorderDraggingId  = $state(null);
  let reorderInsertIdx   = $state(null);

  // Phones get readable month columns (scroll sideways) instead of squeezing everything to fit
  let zoom            = $state(window.innerWidth < MOBILE_W ? 'month' : 'fit');
  let showTodayLine   = $state(true);
  let printPanelOpen  = $state(false);
  let hideLegendPrint = $state(false);
  let printMultiPage  = $state(false);

  let shareCopied = $state(false);
  let shareCopiedTimer = null;
  function shareProject() {
    const url = `${window.location.origin}${window.location.pathname}#schedule-share/${encodeURIComponent(data.id)}`;
    navigator.clipboard.writeText(url).then(() => {
      shareCopied = true;
      clearTimeout(shareCopiedTimer);
      shareCopiedTimer = setTimeout(() => { shareCopied = false; }, 2000);
    });
  }

  let footerH = $state(null); // null = auto height

  function startFooterResize(e) {
    const startY = e.clientY;
    const startH = footerH ?? e.currentTarget.nextElementSibling?.getBoundingClientRect().height ?? 180;
    const maxH   = Math.min(600, window.innerHeight * 0.75);
    pointerDrag(e, {
      holdMs: 0,
      onMove(ev) { footerH = Math.max(48, Math.min(maxH, startH + (startY - ev.clientY))); },
    });
  }

  // Timeline range controls
  function adjustView(startDelta, endDelta) {
    if (!project) return;
    const vs = parseDate(project.viewStart);
    const ve = parseDate(project.viewEnd);
    vs.setMonth(vs.getMonth() + startDelta);
    ve.setMonth(ve.getMonth() + endDelta);
    const monthSpan = (ve.getFullYear() - vs.getFullYear()) * 12 + ve.getMonth() - vs.getMonth();
    if (monthSpan < 2) return;
    projectStore.updateProject(data.id, { viewStart: toISO(vs), viewEnd: toISO(ve) });
  }

  function fmtMonthYear(dateStr) {
    const d = parseDate(dateStr);
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }

  // True when some task dates fall outside the visible month range
  let tasksOutsideView = $derived.by(() => {
    if (!project || !trueStart || !trueEnd) return false;
    const s = parseDate(trueStart), e = parseDate(trueEnd);
    const vs = parseDate(project.viewStart), ve = parseDate(project.viewEnd);
    return s < new Date(vs.getFullYear(), vs.getMonth(), 1) ||
           e >= new Date(ve.getFullYear(), ve.getMonth() + 1, 1);
  });

  function fitView() {
    if (!project || !trueStart || !trueEnd) return;
    const s  = parseDate(trueStart);
    const e  = parseDate(trueEnd);
    // One month of breathing room before the first task and after the last, so nothing sits on the edge.
    const vs = new Date(s.getFullYear(), s.getMonth() - 1, 1);
    const ve = new Date(e.getFullYear(), e.getMonth() + 1, 1);
    projectStore.updateProject(data.id, { viewStart: toISO(vs), viewEnd: toISO(ve) });
  }

  // The assistant's whole reply is checked and applied as one edit, so one Undo reverses it.
  function handleAiChanges(changes) {
    projectStore.applyChanges(data.id, changes);
  }

  function openPrintPanel() {
    if (project) sessionStorage.setItem('r3a_preview', JSON.stringify(project));
    printPanelOpen = true;
  }

  /** The schedule as a PDF made on the server: exact paper size, landscape, the same for everyone. */
  async function downloadPdf({ showToday = true, showLegend = true, paper = 'tabloid' } = {}) {
    if (!project) return;
    const today    = new Date();
    const yyyymmdd = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const filename = [project.number?.trim(), yyyymmdd, 'Project Schedule'].filter(Boolean).join('_');
    const res = await fetch('/api/schedule-pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-code': accessCode() },
      body: JSON.stringify({ schedule: project, paper, showToday, showLegend, filename }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Couldn't make the PDF (${res.status}).`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `${filename}.pdf` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    printPanelOpen = false;
  }

  function printSchedule({ showToday = true, showLegend = true, paper = 'tabloid' } = {}) {
    printPanelOpen = false;
    if (project) sessionStorage.setItem('r3a_preview', JSON.stringify(project));

    const today    = new Date();
    const yyyymmdd = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const num      = project?.number?.trim();
    const title    = [num, yyyymmdd, 'Project Schedule'].filter(Boolean).join('_');

    const params = new URLSearchParams({
      paper,
      autoprint: '1',
      today:  showToday  ? '1' : '0',
      legend: showLegend ? '1' : '0',
      title,
    });

    window.open(`${window.location.pathname}#schedule-print?${params}`, '_blank');
  }
</script>

<svelte:window onkeydown={handleKeyDown} bind:innerWidth={innerW} />

{#if !project}
  <div class="not-found">
    <p>Schedule not found.</p>
    <button onclick={() => goto('/')}>← Back to Schedules</button>
  </div>
{:else}
  <div class="schedule-page" class:ai-open={aiOpen} class:multi-page={printMultiPage}>

    <!-- Page header -->
    <header class="sch-hdr no-print-border">
      <div class="hdr-left">
        <div class="hdr-titles">
          <div
            bind:this={titleEl}
            class="hdr-title"
            contenteditable="true"
            spellcheck="false"
            onblur={(e) => updateTitle(e.target.textContent.trim() || project.title)}
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
          ></div>
          <div class="hdr-meta">
            <div
              class="meta-field"
              contenteditable="true"
              spellcheck="false"
              onblur={(e) => updateMeta('date', e.target.textContent.trim())}
            >{project.date || 'Date'}</div>
            <span class="meta-sep">·</span>
            <div
              class="meta-field"
              contenteditable="true"
              spellcheck="false"
              onblur={(e) => updateMeta('number', e.target.textContent.trim())}
            >{project.number || 'Project Number'}</div>
            <span class="meta-sep">·</span>
            <div
              class="meta-field"
              contenteditable="true"
              spellcheck="false"
              onblur={(e) => updateMeta('client', e.target.textContent.trim())}
            >{project.client || 'Client'}</div>
          </div>
        </div>
      </div>

      {#if $saveError}
        <!-- A failed save stays on screen until the next save works, so edits are never lost silently. -->
        <p class="save-error no-print" role="alert">{$saveError}</p>
      {/if}
      <div class="hdr-actions no-print">
        <button class="action-btn action-btn-undo" onclick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button class="action-btn" onclick={openPrintPanel} title="Print / Export PDF">
          Print
        </button>
        <button class="action-btn action-btn-share" onclick={shareProject} title="Copy shareable link">
          {shareCopied ? 'Copied!' : 'Share'}
        </button>
        <button class="action-btn action-btn-delete" onclick={deleteSchedule} title="Delete this schedule">
          Delete
        </button>
        <button class="action-btn action-btn-ai" onclick={() => aiOpen = !aiOpen} title="AI Schedule Assistant">
          AI
        </button>
      </div>
    </header>

    <!-- Timeline range control strip -->
    <div class="timeline-bar no-print">
      <div class="tl-end">
        <span class="tl-lbl">Show from</span>
        <div class="tl-ctrl">
          <button class="tl-btn" onclick={() => adjustView(-1, 0)} title="Start one month earlier (adds a column)">‹</button>
          <span class="tl-date">{fmtMonthYear(project.viewStart)}</span>
          <button class="tl-btn" onclick={() => adjustView(1, 0)} title="Start one month later (removes a column)">›</button>
        </div>
      </div>

      <div class="tl-center">
        <button class="tl-shift" onclick={() => adjustView(-1, -1)} title="Slide the view one month earlier (same number of months)">◀</button>
        <span class="tl-dur">{ganttMonths.length} {isMobile ? 'mo' : 'months shown'}</span>
        <button class="tl-shift" onclick={() => adjustView(1, 1)} title="Slide the view one month later (same number of months)">▶</button>
        <button class="tl-fit" class:tl-fit-warn={tasksOutsideView} onclick={fitView}
          title="Set the view to cover all tasks">{tasksOutsideView ? (isMobile ? 'Tasks hidden · Fit' : 'Some tasks hidden · Fit to tasks') : (isMobile ? 'Fit tasks' : 'Fit to tasks')}</button>
      </div>

      <div class="tl-end tl-end-right">
        <div class="view-opts">
          <div class="zoom-ctrl">
            <button class="zoom-btn" class:zoom-active={zoom === 'fit'}    onclick={() => zoom = 'fit'}   >Fit</button>
            <button class="zoom-btn" class:zoom-active={zoom === 'month'}  onclick={() => zoom = 'month'} >Mo</button>
            <button class="zoom-btn" class:zoom-active={zoom === 'biweek'} onclick={() => zoom = 'biweek'}>2W</button>
            <button class="zoom-btn" class:zoom-active={zoom === 'week'}   onclick={() => zoom = 'week'}>Wk</button>
          </div>
          <button
            class="today-toggle"
            class:today-toggle-on={showTodayLine}
            onclick={() => showTodayLine = !showTodayLine}
            title="Toggle today line"
          ><span class="today-pip"></span>Today</button>
        </div>
        <div class="tl-ctrl">
          <button class="tl-btn" onclick={() => adjustView(0, -1)} title="End one month earlier (removes a column)">‹</button>
          <span class="tl-date">{fmtMonthYear(project.viewEnd)}</span>
          <button class="tl-btn" onclick={() => adjustView(0, 1)} title="End one month later (adds a column)">›</button>
        </div>
        <span class="tl-lbl">Show through</span>
      </div>
    </div>

    <!-- Main schedule area -->
    <div class="sch-body">
      <div class="sch-main">
        <div class="sch-scroll" bind:this={schScrollEl} bind:offsetWidth={schW}>
          <div class="sch-inner" style:width="{TASK_COL_W + ganttWidth}px">

            <TaskPanel
              width={TASK_COL_W}
              markerLanes={markerLanes}
              tasks={project.tasks}
              onRename={handleRename}
              onDelete={handleDelete}
              onReorder={handleReorder}
              onAdd={handleAdd}
              onDragChange={(id, idx) => { reorderDraggingId = id; reorderInsertIdx = idx; }}
              highlightId={draggingTaskId}
              zoom={displayZoom}
            />

            <GanttPanel

              bind:markerLanes
              tasks={project.tasks}
              viewStart={project.viewStart}
              viewEnd={project.viewEnd}
              todayMark={toISO(new Date())}
              legend={project.legend}
              dropDate={dropDate}
              highlightTaskId={highlightTaskId}
              onTaskUpdate={handleTaskUpdate}
              onLegendItemUpdate={handleLegendItemUpdate}
              onDraggingChange={handleDraggingChange}
              onColorChange={(id, color) => projectStore.updateTask(data.id, id, { color })}
              reorderDraggingId={reorderDraggingId}
              reorderInsertIdx={reorderInsertIdx}
              zoom={displayZoom}
              colWOverride={zoom === 'fit' || printColW !== null ? effectiveColW : null}
              showTodayLine={showTodayLine}
            />

          </div>
        </div>
      </div>

      <div class="footer-resizer no-print" onpointerdown={startFooterResize}></div>

      <div class="print-foot" class:no-print={hideLegendPrint}>
        <div class="legend-wrap" class:legend-auto={!footerH}
             style:height={footerH ? footerH + 'px' : null}
             style:overflow-y={footerH ? 'auto' : null}>
          <LegendFooter
            legend={project.legend}
            tasks={project.tasks}
            onUpdate={handleLegendUpdate}
            onMilestoneDrag={startMilestoneDrag}
            onApprovalDrag={startApprovalDrag}
            onEstimateDrag={startEstimateDrag}
            onAddMilestone={handleAddMilestone}
            onAddDeliverable={handleAddDeliverable}
            onAddApproval={handleAddApproval}
            onAddEstimate={handleAddEstimate}
            onLinkClick={linkToGantt}
            notes={project.notes ?? ''}
            onNotesUpdate={(val) => projectStore.updateProject(data.id, { notes: val })}
          />
        </div>
        <div class="r3a-mark no-screen">R3A</div>
      </div>
    </div>

    <AiSidebar open={aiOpen} project={project} onApplyChanges={handleAiChanges} onClose={() => aiOpen = false} />

    <PrintPanel
      open={printPanelOpen}
      projectId={data.id}
      contentWidth={TASK_COL_W + ganttWidth}
      monthCount={ganttMonths.length}
      showTodayDefault={showTodayLine}
      onPrint={printSchedule}
      onDownload={downloadPdf}
      onClose={() => printPanelOpen = false}
    />

  </div>
{/if}

<style>
  .not-found {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: calc(100vh - var(--site-header-h, 0px)); gap: 16px; font-family: 'Barlow', sans-serif; color: var(--black);
  }
  .not-found button {
    background: var(--blue); color: #fff; border: none; border-radius: 3px;
    padding: 10px 20px; cursor: pointer; font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  }

  .schedule-page {
    display: flex;
    flex-direction: column;
    /* The window below the site header; dvh excludes mobile browser toolbars. */
    height: calc(100vh - var(--site-header-h, 0px));
    height: calc(100dvh - var(--site-header-h, 0px));
    overflow: hidden;
    background: #fff;
    transition: padding-right .22s ease;
  }
  .schedule-page.ai-open { padding-right: 310px; }

  /* Header */
  .sch-hdr {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 10px 18px 8px;
    border-bottom: 2px solid var(--black);
    flex-shrink: 0;
    gap: 16px;
    background: #fff;
  }
  .hdr-left {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }
  .hdr-titles { min-width: 0; }
  .hdr-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 22px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--black);
    outline: none;
    cursor: text;
    line-height: 1.1;
  }
  .hdr-title:focus { background: rgba(255,210,0,.25); border-radius: 2px; padding: 0 4px; }
  .hdr-title:empty::before { content: 'Project Title'; color: #ccc; pointer-events: none; }
  .hdr-meta {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px 0;
    margin-top: 5px;
  }
  .meta-sep {
    font-size: 11px;
    color: var(--black);
    padding: 0 5px;
    user-select: none;
  }
  .meta-field {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
    outline: none;
    cursor: text;
  }
  .meta-field:focus { background: rgba(32,171,226,.06); border-radius: 2px; padding: 0 4px; }
  .hdr-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
    padding-top: 2px;
  }
  .action-btn {
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .1em;
    border: 1px solid var(--lgray);
    background: #fff;
    color: var(--black);
    border-radius: 3px;
    padding: 6px 13px;
    cursor: pointer;
    transition: border-color .12s, background .12s;
  }
  .action-btn:hover { border-color: var(--blue); background: rgba(32,171,226,.05); }
  .action-btn-undo:disabled { opacity: 0.35; cursor: default; }
  .action-btn-undo:disabled:hover { border-color: var(--lgray); background: #fff; }
  .action-btn-ai { border-color: var(--blue); color: var(--blue); }
  .action-btn-ai:hover { background: var(--blue); color: #fff; }
  .action-btn-share { transition: border-color .12s, background .12s, color .12s; }
  .action-btn-share:hover { border-color: var(--black); background: var(--black); color: #fff; }
  .save-error { margin: 0 12px 0 auto; align-self: center; color: #b3261e; font-size: 12px; font-weight: 600; }
  .action-btn-delete:hover { border-color: #b3261e; background: #b3261e; color: #fff; }

  /* Timeline control strip */
  .timeline-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    height: 32px;
    background: var(--off);
    border-bottom: 1px solid var(--lgray);
    flex-shrink: 0;
    gap: 12px;
  }
  .tl-end {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tl-end-right { flex-direction: row-reverse; }
  .tl-lbl {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .06em;
    white-space: nowrap;
    color: var(--black);
  }
  .tl-ctrl {
    display: flex;
    align-items: center;
    background: #fff;
    border: 1px solid var(--lgray);
    border-radius: 3px;
    overflow: hidden;
  }
  .tl-btn {
    background: none;
    border: none;
    padding: 0 8px;
    height: 22px;
    cursor: pointer;
    font-size: 14px;
    color: var(--black);
    transition: background .1s, color .1s;
    line-height: 1;
  }
  .tl-btn:hover { background: var(--blue); color: #fff; }
  .tl-date {
    font-family: 'Barlow', sans-serif;
    font-weight: 600;
    font-size: 11px;
    color: var(--black);
    padding: 0 6px;
    border-left: 1px solid var(--lgray);
    border-right: 1px solid var(--lgray);
    white-space: nowrap;
    line-height: 22px;
  }
  .tl-center {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tl-dur {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--black);
    white-space: nowrap;
  }
  .tl-shift {
    background: none;
    border: none;
    font-size: 11px;
    color: var(--black);
    cursor: pointer;
    padding: 2px 4px;
    transition: color .1s;
    line-height: 1;
  }
  .tl-shift:hover { color: var(--blue); }
  .tl-fit {
    background: #fff; border: 1px solid var(--lgray); border-radius: 3px; padding: 0 8px; height: 22px;
    font-family: 'Barlow', sans-serif; font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: .08em;
    color: var(--black); cursor: pointer;
    transition: color .1s; line-height: 1;
  }
  .tl-fit:hover { color: var(--blue); border-color: var(--blue); }
  .tl-fit-warn { color: var(--mag); border-color: var(--mag); }

  /* View options group (zoom + today toggle) */
  .view-opts {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: 10px;
  }
  .zoom-ctrl {
    display: flex;
    background: #fff;
    border: 1px solid var(--lgray);
    border-radius: 3px;
    overflow: hidden;
  }
  .zoom-btn {
    background: none; border: none; border-right: 1px solid var(--lgray);
    padding: 0 8px; height: 22px;
    font-family: 'Barlow', sans-serif; font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--black); cursor: pointer; transition: background .1s, color .1s;
    line-height: 1;
  }
  .zoom-btn:last-child { border-right: none; }
  .zoom-btn:hover:not(.zoom-active) { background: rgba(32,171,226,.08); color: var(--blue); }
  .zoom-active { background: var(--blue); color: #fff; }

  /* Today toggle — no button chrome, just a pip + label */
  .today-toggle {
    background: none; border: none; padding: 0;
    display: flex; align-items: center; gap: 4px;
    font-family: 'Barlow', sans-serif; font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: .08em;
    color: var(--black); cursor: pointer;
    transition: color .15s;
  }
  .today-toggle:hover { color: var(--black); }
  .today-toggle-on { color: var(--black); }
  .today-pip {
    width: 7px; height: 7px; border-radius: 50%;
    background: currentColor; flex-shrink: 0;
    transition: background .15s;
  }

  /* Body */
  .sch-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .sch-main {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
  .sch-scroll { width: 100%; height: 100%; overflow: auto; }
  .sch-inner  { display: flex; min-height: 100%; }

  .print-foot {
    flex-shrink: 0;
  }

  .footer-resizer {
    height: 5px;
    flex-shrink: 0;
    cursor: row-resize;
    background: var(--lgray);
    transition: background .15s;
    position: relative;
    z-index: 10;
  }
  .footer-resizer:hover,
  .footer-resizer:active { background: var(--blue); }
  .footer-resizer { touch-action: none; }

  /* ── Touch: larger hit targets ── */
  @media (pointer: coarse) {
    .action-btn { padding: 9px 14px; }
    .tl-btn, .zoom-btn, .tl-fit { height: 32px; }
    .tl-btn  { padding: 0 12px; font-size: 16px; }
    .zoom-btn { padding: 0 11px; }
    .tl-date { line-height: 32px; }
    .tl-shift { padding: 8px 6px; font-size: 13px; }
    .today-toggle { padding: 8px 2px; }
    .footer-resizer { height: 16px; display: flex; align-items: center; justify-content: center; }
    .footer-resizer::after {
      content: ''; width: 36px; height: 4px; border-radius: 2px; background: var(--mgray);
    }
    .meta-field, .meta-sep { font-size: 13px; }
  }

  /* ── Phones ── */
  @media screen and (max-width: 640px) {
    .schedule-page.ai-open { padding-right: 0; }

    .sch-hdr { flex-wrap: wrap; padding: 8px 12px 8px; gap: 8px; }
    .hdr-left { width: 100%; gap: 10px; }
    .hdr-title { font-size: 18px; }
    .hdr-actions { width: 100%; gap: 6px; padding-top: 0; }
    .action-btn { flex: 1; padding-left: 4px; padding-right: 4px; }

    .timeline-bar {
      height: auto; flex-wrap: wrap; justify-content: center;
      padding: 6px 8px; gap: 6px 12px;
    }
    .tl-lbl { display: none; }
    .tl-end-right { flex-direction: row; }
    .view-opts { margin-right: 4px; }

    /* Legend gets at most ~1/3 of the screen unless the user drags the resizer */
    .legend-auto { max-height: 34dvh; overflow-y: auto; }
  }

  /* R3A print mark */
  .r3a-mark {
    display: none;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 22px;
    color: var(--black);
    letter-spacing: .04em;
    position: fixed;
    bottom: 0.45in;
    right: 0.55in;
  }

  @media screen {
    .no-screen { display: none !important; }
  }

  @media print {
    /* A named page, so this size only applies to the schedule (its styles stay loaded after leaving it). */
    @page schedule-editor { size: letter landscape; margin: 0.4in; }
    .schedule-page { page: schedule-editor; }
    :root { zoom: var(--print-scale, 1); }

    .no-print     { display: none !important; }
    .no-print-border { border-bottom-width: 1.5px !important; }

    /* ── Single-page mode (default): everything on one page, footer at bottom ── */
    .schedule-page {
      padding: 0 !important;
      height: 100vh !important;   /* definite height so flex: 1 on sch-body actually expands */
    }
    .sch-hdr { padding: 8px 14px 6px; }
    .hdr-title { font-size: 20px; }

    .sch-body {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: visible !important;
      height: auto !important;
    }
    .sch-main   { overflow: visible !important; height: auto !important; flex: none !important; }
    .sch-scroll { overflow: visible !important; width: 100% !important; height: auto !important; }
    .sch-inner  { min-height: unset !important; }

    /* Footer floats to bottom in single-page mode */
    .print-foot { margin-top: auto; }

    /* ── Multi-page mode: tasks flow freely, footer forced onto its own final page ── */
    .schedule-page.multi-page { height: auto !important; }
    .schedule-page.multi-page .sch-body { flex: none !important; }
    .schedule-page.multi-page .print-foot {
      break-before: page !important;
      margin-top: 0 !important;
    }

    .legend-wrap {
      position: static !important;
      height: auto !important;
      overflow: visible !important;
      background: #fff;
      break-inside: avoid;
    }

    .r3a-mark {
      display: block !important;
      position: static !important;
      text-align: right;
      padding: 4px 0 0;
      font-size: 28px;
    }
  }
</style>
