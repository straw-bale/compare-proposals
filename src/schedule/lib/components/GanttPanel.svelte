<script>
  import { parseDate, toISO, timeColumns, ZOOM_COL_W, totalDays, dateToPx, dateToPxMonth, pxToDateMonth, dateToPxPeriod, pxToDatePeriod, dateToPxQuarter, pxToDateQuarter, isLightColor, MONTHS_SHORT, toWeekday } from '../utils/dates.js';
  import { pointerDrag } from '../utils/pointer.js';

  const ROW_H = 26;

  let {
    tasks, viewStart: vsStr, viewEnd: veStr, todayMark: tmStr,
    onTaskUpdate, onLegendItemUpdate = null, onDraggingChange = null, onColorChange = null,
    legend = null, dropDate = null, highlightTaskId = null,
    zoom = 'month', showTodayLine = true,
    reorderDraggingId = null, reorderInsertIdx = null,
    colWOverride = null,
    markerLanes = $bindable(1),
  } = $props();

  // Task ID that a reorder gap should appear before (null = no gap, 'end' = after all tasks)
  let gapBeforeId = $derived.by(() => {
    if (reorderDraggingId === null || reorderInsertIdx === null) return null;
    let vis = 0;
    for (const t of tasks) {
      if (t.id === reorderDraggingId) continue;
      if (vis === reorderInsertIdx) return t.id;
      vis++;
    }
    return 'end';
  });

  // Ghost bar at the drop target position (follows the gap)
  let ghostTask = $derived(reorderDraggingId !== null && reorderInsertIdx !== null
    ? tasks.find(t => t.id === reorderDraggingId) ?? null
    : null);
  let ghostY = $derived(reorderInsertIdx !== null ? reorderInsertIdx * ROW_H : null);

  // `half` is the 50% halftone (solid color mixed 50/50 with white)
  const BAR_COLORS = [
    { hex: '#282829', half: '#949494', label: 'Black — Programming / Bidding / Closeout', halfLabel: 'Gray — Client / Design Review' },
    { hex: '#00914D', half: '#80C8A6', label: 'Lime — Design phases (SD, DD, CDs)'      },
    { hex: '#20ABE2', half: '#90D5F1', label: 'Blue — Holds / Waiting periods'           },
    { hex: '#6D245D', half: '#B692AE', label: 'Berry — Construction & CA'                },
    { hex: '#D83968', half: '#EC9CB4', label: 'Magenta — Permit / AHJ'                   },
  ];
  const SWATCH_ROWS = [
    BAR_COLORS.map(c => ({ hex: c.hex,  label: c.label })),
    BAR_COLORS.map(c => ({ hex: c.half, label: c.halfLabel ?? `${c.label} (50% halftone)` })),
  ];

  let viewStart  = $derived(parseDate(vsStr));
  let viewEnd    = $derived(parseDate(veStr));
  let colW       = $derived(colWOverride !== null ? colWOverride : (ZOOM_COL_W[zoom] ?? 72));
  let columns    = $derived(timeColumns(viewStart, viewEnd, zoom));
  let ganttWidth = $derived(columns.length * colW);
  let totalH     = $derived(tasks.length * ROW_H);

  let yearGroups = $derived.by(() => {
    const map = {};
    columns.forEach(c => { const y = c.getFullYear(); map[y] = (map[y] || 0) + 1; });
    return Object.entries(map).map(([year, count]) => ({ year, count: Number(count) }));
  });

  // Month span groups for biweek/weekly header
  let mGroups = $derived.by(() => {
    if (zoom === 'month' || zoom === 'quarter') return [];
    const groups = [];
    let cur = null;
    for (const col of columns) {
      const key = `${col.getFullYear()}-${col.getMonth()}`;
      if (!cur || cur.key !== key) {
        cur = { key, label: MONTHS_SHORT[col.getMonth()], count: 1 };
        groups.push(cur);
      } else {
        cur.count++;
      }
    }
    return groups;
  });

  let todayPx   = $derived(
    zoom === 'month'  ? dateToPxMonth(tmStr, viewStart, colW) :
    zoom === 'quarter' ? dateToPxQuarter(tmStr, viewStart, colW) :
    zoom === 'biweek' ? dateToPxPeriod(tmStr, viewStart, colW, 14) :
    zoom === 'week'   ? dateToPxPeriod(tmStr, viewStart, colW, 7) :
    dateToPx(tmStr, viewStart, viewEnd, ganttWidth));
  let showToday = $derived(showTodayLine && !!tmStr && todayPx >= 0 && todayPx <= ganttWidth);

  // Local bar drag state
  let draggingId   = $state(null);
  let draggingTask = $state(null);

  let displayTasks = $derived(
    draggingId !== null
      ? tasks.map(t => t.id === draggingId ? draggingTask : t)
      : tasks
  );

  // Legend overlay drag state
  let draggingOverlay = $state(null); // { section, idx, date }

  // Date popup
  let popupTask = $state(null);
  let popupX    = $state(0);
  let popupY    = $state(0);

  // Validation helpers
  function delValid(num) {
    if (!legend || !num) return true;
    return num >= 1 && num <= legend.deliverables.length;
  }
  function msValid(code) {
    if (!legend || !code) return true;
    return legend.milestones.some(m => m.code === code);
  }

  function px(dateStr) {
    if (zoom === 'month')  return dateToPxMonth(dateStr, viewStart, colW);
    if (zoom === 'quarter') return dateToPxQuarter(dateStr, viewStart, colW);
    if (zoom === 'biweek') return dateToPxPeriod(dateStr, viewStart, colW, 14);
    if (zoom === 'week')   return dateToPxPeriod(dateStr, viewStart, colW, 7);
    return dateToPx(dateStr, viewStart, viewEnd, ganttWidth);
  }

  function pxToDate(xPx) {
    if (zoom === 'month')  return pxToDateMonth(xPx, viewStart, colW);
    if (zoom === 'quarter') return pxToDateQuarter(xPx, viewStart, colW);
    if (zoom === 'biweek') return pxToDatePeriod(xPx, viewStart, colW, 14);
    if (zoom === 'week')   return pxToDatePeriod(xPx, viewStart, colW, 7);
    const totalMs = viewEnd.getTime() - viewStart.getTime();
    const ms = viewStart.getTime() + (xPx / ganttWidth) * totalMs;
    const d = new Date(ms);
    return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  function openPopup(task, cx, cy) {
    popupTask = { ...task };
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = 240, ph = 260;
    popupX = Math.max(8, Math.min(cx + 10 + pw > vw ? cx - pw : cx + 10, vw - pw - 8));
    popupY = Math.max(8, Math.min(cy + 8 + ph > vh ? cy - ph : cy + 8, vh - ph - 8));
  }
  function closePopup() { popupTask = null; }
  function onPopupChange(field, val) {
    if (!popupTask) return;
    popupTask = { ...popupTask, [field]: val };
    onTaskUpdate(popupTask.id, { [field]: val });
  }
  // Switch a task between a bar and a milestone dot. The bar's start/end are kept on the
  // task so switching back restores the original span.
  function setShape(type) {
    if (!popupTask || popupTask.type === type) return;
    let patch;
    if (type === 'milestone') {
      patch = { type, date: toWeekday(popupTask.end ?? popupTask.start) };
    } else {
      const start = popupTask.start ?? popupTask.date;
      let end = popupTask.end;
      if (!end || end <= start) { const d = parseDate(start); d.setDate(d.getDate() + 14); end = toISO(d); }
      patch = { type, start, end, color: popupTask.color ?? '#20ABE2' };
    }
    popupTask = { ...popupTask, ...patch };
    onTaskUpdate(popupTask.id, patch);
  }

  // Bar drag (move / left-resize / right-resize). On touch: long-press to drag, tap to edit.
  function startDrag(e, task, mode, which = -1) {
    e.stopPropagation();

    const pxPerDay  = ganttWidth / totalDays(viewStart, viewEnd);
    const startX    = e.clientX;
    const origStart = task.start;
    const origEnd   = task.end;
    const extras    = task.extraDates ?? [];
    const origDate  = which >= 0 ? extras[which] : task.date;

    pointerDrag(e, {
      onStart() {
        draggingId   = task.id;
        draggingTask = { ...task };
        onDraggingChange?.(task.id);
      },
      onMove(ev) {
        const dd    = Math.round((ev.clientX - startX) / pxPerDay);
        const draft = { ...draggingTask };

        if (task.type === 'milestone') {
          const d = parseDate(origDate); d.setDate(d.getDate() + dd);
          if (which >= 0) draft.extraDates = extras.map((x, i) => (i === which ? toWeekday(toISO(d)) : x));
          else draft.date = toWeekday(toISO(d));
        } else if (mode === 'move') {
          const ns = parseDate(origStart); ns.setDate(ns.getDate() + dd);
          const ne = parseDate(origEnd);   ne.setDate(ne.getDate() + dd);
          draft.start = toISO(ns); draft.end = toISO(ne);
        } else if (mode === 'left') {
          const ns = parseDate(origStart); ns.setDate(ns.getDate() + dd);
          if (ns < parseDate(origEnd)) draft.start = toISO(ns);
        } else if (mode === 'right') {
          const ne = parseDate(origEnd); ne.setDate(ne.getDate() + dd);
          if (ne > parseDate(origStart)) draft.end = toISO(ne);
        }
        draggingTask = draft;
      },
      onEnd() {
        const patch = task.type !== 'milestone'
          ? { start: draggingTask.start, end: draggingTask.end }
          : which >= 0 ? { extraDates: draggingTask.extraDates } : { date: draggingTask.date };
        const changed = task.type !== 'milestone'
          ? patch.start !== origStart || patch.end !== origEnd
          : which >= 0 ? patch.extraDates[which] !== origDate : patch.date !== origDate;
        if (changed) onTaskUpdate(task.id, patch);
        draggingId = null;
        draggingTask = null;
        onDraggingChange?.(null);
      },
      // Touch has no reliable double-click — a tap opens the date/color popup
      onTap(ev) { openPopup(task, ev.clientX, ev.clientY); },
    });
  }

  // Legend overlay drag (milestones / deliverables)
  function startOverlayDrag(e, section, idx, origDate) {
    e.stopPropagation();
    const origPx = px(origDate);
    const startX = e.clientX;

    pointerDrag(e, {
      onStart() { draggingOverlay = { section, idx, date: origDate }; },
      onMove(ev) {
        const newPx = Math.max(0, Math.min(ganttWidth, origPx + (ev.clientX - startX)));
        draggingOverlay = { section, idx, date: toWeekday(pxToDate(newPx)) };
      },
      onEnd() {
        if (draggingOverlay && draggingOverlay.date !== origDate && onLegendItemUpdate) {
          onLegendItemUpdate(draggingOverlay.section, draggingOverlay.idx, { date: draggingOverlay.date });
        }
        draggingOverlay = null;
      },
    });
  }

  // Get effective date for an overlay item (uses drag draft during drag)
  function overlayDate(section, idx, item) {
    if (draggingOverlay?.section === section && draggingOverlay.idx === idx) return draggingOverlay.date;
    return item.date;
  }

  // Markers that would overlap in the markers row are stacked into extra lanes.
  const LANE_H = 18;
  let laneOf = $derived.by(() => {
    const items = [];
    const add = (section, list, labelFn) => (list ?? []).forEach((it, i) => {
      const date = overlayDate(section, i, it);
      if (!date) return;
      const label = labelFn ? String(labelFn(it, i) ?? '') : null;
      // Approximate rendered width: pills ~7px per char + padding; approval diamond ~14px
      const w = label === null ? 14 : Math.max(16, label.length * 7 + 10);
      items.push({ key: `${section}:${i}`, x: px(date), w });
    });
    add('milestones',   legend?.milestones,   m => m.code);
    add('deliverables', legend?.deliverables, (_, i) => i + 1);
    add('approvals',    legend?.approvals,    null);
    add('estimates',    legend?.estimates,    e => e.code);
    items.sort((a, b) => a.x - b.x);
    const laneEnds = [];
    const map = {};
    for (const it of items) {
      const left = it.x - it.w / 2;
      let lane = laneEnds.findIndex(end => left >= end + 3);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.x + it.w / 2;
      map[it.key] = lane;
    }
    return { map, count: Math.max(1, laneEnds.length) };
  });
  $effect(() => { markerLanes = laneOf.count; });
  // Vertical center of a marker in its lane (row is 22px for a single lane)
  const laneTop = (section, i) => `${11 + (laneOf.map[`${section}:${i}`] ?? 0) * LANE_H}px`;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="gantt-scroll">
  <div class="gantt-inner" style:width="{ganttWidth}px">

    <!-- Time header (sticky) -->
    <div class="time-hdr">

      <!-- Year row -->
      <div class="year-row">
        {#each yearGroups as yg}
          <div class="year-block" style:width="{yg.count * colW}px">{yg.year}</div>
        {/each}
      </div>

      {#if zoom === 'month' || zoom === 'quarter'}
        <!-- Month row (monthly zoom), or quarters (Q1–Q4) for compact prints -->
        <div class="month-row">
          {#each columns as col}
            <div class="month-cell" class:quarter-cell={zoom === 'quarter'} style:width="{colW}px">{zoom === 'quarter' ? `Q${Math.floor(col.getMonth() / 3) + 1}` : MONTHS_SHORT[col.getMonth()]}</div>
          {/each}
        </div>
      {:else}
        <!-- Month spans + column detail rows (biweek / weekly zoom) -->
        <div class="month-row mspan-row">
          {#each mGroups as mg}
            <div class="month-cell" style:width="{mg.count * colW}px">{mg.label}</div>
          {/each}
        </div>
        <div class="col-row">
          {#each columns as col}
            <div class="col-cell" style:width="{colW}px">{col.getDate()}</div>
          {/each}
        </div>
      {/if}

      <!-- Markers row: draggable milestone & deliverable pills -->
      <div class="markers-row" style:height="{22 + (laneOf.count - 1) * LANE_H}px">
        {#each (legend?.milestones ?? []) as m, i}
          {@const date = overlayDate('milestones', i, m)}
          {#if date}
            {@const mpx = px(date)}
            {#if mpx >= -30 && mpx <= ganttWidth + 30}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="ov-pill"
                style:left="{mpx}px"
                style:top={laneTop('milestones', i)}
                onpointerdown={(e) => startOverlayDrag(e, 'milestones', i, m.date)}
                title="{m.text} — drag to reposition"
              >{m.code}</div>
            {/if}
          {/if}
        {/each}
        {#each (legend?.deliverables ?? []) as d, i}
          {@const date = overlayDate('deliverables', i, d)}
          {#if date}
            {@const dpx = px(date)}
            {#if dpx >= -30 && dpx <= ganttWidth + 30}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="ov-pill ov-del"
                style:left="{dpx}px"
                style:top={laneTop('deliverables', i)}
                onpointerdown={(e) => startOverlayDrag(e, 'deliverables', i, d.date)}
                title="{d.text} — drag to reposition"
              >{i + 1}</div>
            {/if}
          {/if}
        {/each}
        {#each (legend?.approvals ?? []) as a, i}
          {#if a.date}
            {@const apx = px(a.date)}
            {#if apx >= -30 && apx <= ganttWidth + 30}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="ov-approval"
                style:left="{apx}px"
                style:top={laneTop('approvals', i)}
                onpointerdown={(e) => startOverlayDrag(e, 'approvals', i, a.date)}
                title="{a.text} — drag to reposition"
              ></div>
            {/if}
          {/if}
        {/each}
        {#each (legend?.estimates ?? []) as e, i}
          {@const date = overlayDate('estimates', i, e)}
          {#if date}
            {@const epx = px(date)}
            {#if epx >= -30 && epx <= ganttWidth + 30}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="ov-pill"
                style:left="{epx}px"
                style:top={laneTop('estimates', i)}
                style:background={e.color}
                style:color={isLightColor(e.color) ? 'rgba(0,0,0,.65)' : '#fff'}
                onpointerdown={(ev) => startOverlayDrag(ev, 'estimates', i, e.date)}
                title="{e.text} — drag to reposition"
              >{e.code}</div>
            {/if}
          {/if}
        {/each}
      </div>

    </div>

    <!-- Gantt body -->
    <div class="gantt-body">

      <!-- Column bands -->
      <div class="col-bands" style:height="{totalH}px">
        {#each columns as _, i}
          <div class="col-band" class:even={i % 2 === 0} style:width="{colW}px" style:height="{totalH}px"></div>
        {/each}
      </div>

      <!-- Quarter zoom: solid lines where each month and quarter begins -->
      {#if zoom === 'quarter'}
        {#each columns as col, i}
          {#each [0, 1, 2] as m}
            {@const at = new Date(col.getFullYear(), col.getMonth() + m, 1)}
            {@const lx = px(toISO(at))}
            {#if (i > 0 || m > 0) && lx > 0 && lx < ganttWidth}
              <div class="month-line" class:quarter-line={m === 0} style:left="{lx}px" style:height="{totalH}px"></div>
            {/if}
          {/each}
        {/each}
      {/if}

      <!-- Today line -->
      {#if showToday}
        <div class="today-ln" style:left="{todayPx}px" style:height="{totalH}px"></div>
      {/if}

      <!-- Drop indicator (milestone drag from footer) -->
      {#if dropDate}
        {@const dpx = px(dropDate)}
        <div class="drop-ln" style:left="{dpx}px" style:height="{totalH}px">
          <div class="drop-lbl">{dropDate}</div>
        </div>
      {/if}

      <!-- Legend overlay: vertical guide lines below pills -->
      <div class="leg-ov" style:height="{totalH}px">
        {#each (legend?.milestones ?? []) as m, i}
          {@const date = overlayDate('milestones', i, m)}
          {#if date}
            {@const mpx = px(date)}
            {#if mpx >= 0 && mpx <= ganttWidth}
              <div class="ov-line" style:left="{mpx}px" style:height="{totalH}px" style:border-color={m.color}></div>
            {/if}
          {/if}
        {/each}
        {#each (legend?.deliverables ?? []) as d, i}
          {@const date = overlayDate('deliverables', i, d)}
          {#if date}
            {@const dpx = px(date)}
            {#if dpx >= 0 && dpx <= ganttWidth}
              <div class="ov-line ov-del-line" style:left="{dpx}px" style:height="{totalH}px"></div>
            {/if}
          {/if}
        {/each}
        {#each (legend?.approvals ?? []) as a, i}
          {@const date = overlayDate('approvals', i, a)}
          {#if date}
            {@const apx = px(date)}
            {#if apx >= 0 && apx <= ganttWidth}
              <div class="ov-line ov-appr-line" style:left="{apx}px" style:height="{totalH}px"></div>
            {/if}
          {/if}
        {/each}
        {#each (legend?.estimates ?? []) as e, i}
          {@const date = overlayDate('estimates', i, e)}
          {#if date}
            {@const epx = px(date)}
            {#if epx >= 0 && epx <= ganttWidth}
              <div class="ov-line" style:left="{epx}px" style:height="{totalH}px" style:border-color={e.color}></div>
            {/if}
          {/if}
        {/each}
      </div>

      <!-- Bar rows -->
      <div class="bar-rows">
        {#each displayTasks as task (task.id)}
          {#if gapBeforeId === task.id}
            <div class="g-row g-reorder-gap"></div>
          {/if}
          <div
            class="g-row"
            class:row-highlight={task.id === highlightTaskId}
            class:row-dragging={task.id === draggingId}
            class:row-reorder-highlight={task.id === reorderDraggingId && reorderInsertIdx === null}
            class:row-reorder-hidden={task.id === reorderDraggingId && reorderInsertIdx !== null}
          >

            {#if task.type === 'milestone'}
              {@const mpx = px(task.date)}
              {#if mpx >= 0 && mpx <= ganttWidth}
                {#if task.label}
                  <div class="ms-lbl" style:left="{mpx + 8}px">{task.label}</div>
                {/if}
                <div class="ms-dot" style:left="{mpx}px" title={task.date}
                  ondblclick={(e) => openPopup(task, e.clientX, e.clientY)}
                  onpointerdown={(e) => startDrag(e, task, 'move')}></div>
              {/if}
              <!-- More dates on the same row (e.g. several submissions), each its own mark -->
              {#each task.extraDates ?? [] as xd, k}
                {@const xpx = px(xd)}
                {#if xd && xpx >= 0 && xpx <= ganttWidth}
                  <div class="ms-dot" style:left="{xpx}px" title={xd}
                    ondblclick={(e) => openPopup(task, e.clientX, e.clientY)}
                    onpointerdown={(e) => startDrag(e, task, 'move', k)}></div>
                {/if}
              {/each}

            {:else}
              <!-- Clamp bar to visible range; badges always use raw right edge -->
              {@const rawLeft  = px(task.start)}
              {@const rawRight = px(task.end)}
              {@const left     = Math.max(0, rawLeft)}
              {@const width    = Math.max(rawRight - left, 6)}
              {#if rawRight >= 0 && rawLeft <= ganttWidth}

                <div
                  class="bar"
                  class:hold={task.hold}
                  class:estimate={task.isEstimate}
                  class:bar-clipped={rawLeft < 0}
                  style:left="{left}px"
                  style:width="{width}px"
                  style:background={task.color}
                  ondblclick={(e) => openPopup(task, e.clientX, e.clientY)}
                  onpointerdown={(e) => startDrag(e, task, 'move')}
                >
                  {#if rawLeft >= 0}
                    <div class="bar-handle lft" onpointerdown={(e) => startDrag(e, task, 'left')}></div>
                  {/if}
                  <div class="bar-handle rgt" onpointerdown={(e) => startDrag(e, task, 'right')}></div>
                </div>


              {/if}
            {/if}

          </div>
        {/each}
        {#if gapBeforeId === 'end'}
          <div class="g-row g-reorder-gap"></div>
        {/if}

        {#if ghostTask && ghostY !== null && ghostTask.type === 'bar'}
          {@const rawLeft  = px(ghostTask.start)}
          {@const rawRight = px(ghostTask.end)}
          {@const left     = Math.max(0, rawLeft)}
          {@const width    = Math.max(rawRight - left, 6)}
          {#if rawRight >= 0 && rawLeft <= ganttWidth}
            <div class="g-ghost-bar"
              style:top="{ghostY + 2}px"
              style:left="{left}px"
              style:width="{width}px"
              style:background={ghostTask.color}
            ></div>
          {/if}
        {/if}
      </div>

    </div>
  </div>
</div>

<!-- Date popup -->
{#if popupTask}
  <!-- Closes on press, not click: the click that follows a touch tap would otherwise close it at once -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dp-backdrop" onpointerdown={closePopup}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dp" style:left="{popupX}px" style:top="{popupY}px">
    <div class="dp-close" onclick={closePopup}>✕</div>
    <div class="dp-task-name">{popupTask.name}</div>
    <div class="dp-lbl">Shape</div>
    <div class="dp-shape">
      <button class:active={popupTask.type !== 'milestone'} onclick={() => setShape('bar')}>
        <span class="dp-shape-bar"></span>Bar
      </button>
      <button class:active={popupTask.type === 'milestone'} onclick={() => setShape('milestone')}>
        <span class="dp-shape-dot"></span>Milestone
      </button>
    </div>
    {#if popupTask.type === 'milestone'}
      <div class="dp-lbl">Date</div>
      <input type="date" value={popupTask.date} oninput={(e) => { const v = toWeekday(e.target.value); e.target.value = v; onPopupChange('date', v); }}>
      {#if (popupTask.extraDates ?? []).length}<div class="dp-lbl">More dates on this line</div>{/if}
      {#each popupTask.extraDates ?? [] as xd, k}
        <div class="dp-extra">
          <input type="date" value={xd} oninput={(e) => { const v = toWeekday(e.target.value); e.target.value = v; if (v) onPopupChange('extraDates', popupTask.extraDates.map((x, i) => (i === k ? v : x))); }}>
          <button type="button" class="dp-x" title="Remove this date" aria-label="Remove this date" onclick={() => onPopupChange('extraDates', popupTask.extraDates.filter((_, i) => i !== k))}>✕</button>
        </div>
      {/each}
      <button type="button" class="dp-add" onclick={() => { const last = [popupTask.date, ...(popupTask.extraDates ?? [])].filter(Boolean).sort().pop(); const d = parseDate(last ?? toISO(new Date())); d.setDate(d.getDate() + 14); onPopupChange('extraDates', [...(popupTask.extraDates ?? []), toWeekday(toISO(d))]); }}>+ Add another date</button>
    {:else}
      <div class="dp-lbl">Start</div>
      <input type="date" value={popupTask.start} oninput={(e) => onPopupChange('start', e.target.value)}>
      <div class="dp-lbl">End</div>
      <input type="date" value={popupTask.end} oninput={(e) => onPopupChange('end', e.target.value)}>
      <div class="dp-lbl">Color</div>
      {#each SWATCH_ROWS as row}
        <div class="dp-colors">
          {#each row as c}
            <div
              class="dp-swatch"
              class:dp-swatch-active={popupTask.color === c.hex}
              style:background={c.hex}
              title={c.label}
              onclick={() => { onColorChange?.(popupTask.id, c.hex); popupTask = { ...popupTask, color: c.hex }; }}
            ></div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .gantt-scroll { flex: 1; position: relative; min-width: 0; }
  .gantt-inner  { position: relative; min-height: 100%; }

  /* Time header */
  .time-hdr {
    position: sticky; top: 0; z-index: 15;
    background: #fff;
  }
  .year-row { display: flex; height: 18px; border-bottom: 1px solid var(--black); }
  .year-block {
    height: 100%; display: flex; align-items: center; padding: 0 8px;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 11px;
    letter-spacing: .05em; color: var(--black);
    border-right: 1px solid var(--black); flex-shrink: 0;
  }
  .month-row { display: flex; height: 20px; border-bottom: 1px solid var(--black); }
  .month-cell {
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 500; font-size: 11px;
    text-transform: uppercase; letter-spacing: .07em; color: var(--black);
    border-right: 1px dashed var(--black);
  }
  .col-row { display: flex; height: 22px; border-bottom: 1px solid var(--black); }
  .col-cell {
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 500; font-size: 11px;
    color: var(--black); border-right: 1px solid var(--black);
  }

  /* Markers row */
  .markers-row {
    position: relative;
    height: 22px;
    overflow: visible;
    border-bottom: 1px solid var(--black);
    box-sizing: border-box;
  }
  .ov-pill {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    box-sizing: border-box;
    height: 16px;
    min-width: 16px;
    line-height: 16px;
    text-align: center;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
    padding: 0 5px;
    border-radius: 8px;
    cursor: grab;
    white-space: nowrap;
    user-select: none;
    z-index: 20;
    transition: filter .1s;
    background: var(--black);
    color: #fff;
  }
  .ov-pill:hover { filter: brightness(1.15); }
  .ov-pill:active { cursor: grabbing; }
  .ov-del { background: #D4804A; color: #fff; }
  .ov-approval {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%) rotate(45deg);
    width: 10px; height: 10px;
    background: var(--blue);
    cursor: grab;
    user-select: none;
    z-index: 20;
    transition: filter .1s;
  }
  .ov-approval:hover { filter: brightness(1.15); }
  .ov-approval:active { cursor: grabbing; }
  .ov-appr-line { border-color: var(--blue); }

  /* Gantt body */
  .gantt-body { position: relative; }
  .col-bands { position: absolute; top: 0; left: 0; display: flex; pointer-events: none; z-index: 0; }
  .col-band { flex-shrink: 0; }
  .month-line { position: absolute; top: 0; width: 0; border-left: 1px solid rgba(0,0,0,.18); pointer-events: none; z-index: 1; }
  .month-line.quarter-line { border-left-color: var(--black); }
  .month-cell.quarter-cell { border-right-style: solid; }
  .col-band.even { background: rgba(0,0,0,.022); }

  /* Lines */
  .today-ln {
    position: absolute; top: 0; width: 2px; background: var(--black); z-index: 4; pointer-events: none;
  }
  .today-ln::before {
    content: ''; position: absolute; top: -1px; left: -4px;
    border: 5px solid transparent; border-top-color: var(--black);
    border-bottom: none; transform: translateX(-1px);
  }
  .drop-ln {
    position: absolute; top: 0; width: 0; z-index: 8; pointer-events: none;
    border-left: 2px dashed var(--blue);
  }
  .drop-lbl {
    position: absolute; top: 4px; left: 5px;
    background: var(--blue); color: #fff;
    font-family: 'Barlow', sans-serif; font-size: 11px; font-weight: 600;
    padding: 2px 5px; border-radius: 2px; white-space: nowrap;
  }

  /* Legend overlay lines */
  .leg-ov { position: absolute; top: 0; left: 0; width: 100%; pointer-events: none; z-index: 3; }
  .ov-line {
    position: absolute; top: 0; width: 0;
    border-left: 1.5px dashed;
    opacity: .3;
  }
  .ov-del-line { border-color: #D4804A; }

  /* Rows */
  .bar-rows { position: relative; z-index: 4; }
  .g-row    { height: 26px; position: relative; border-bottom: 1px solid var(--black); overflow: visible; }
  .row-highlight  { background: rgba(32,171,226,.14) !important; }
  .row-dragging        { background: rgba(0,0,0,.04); }
  .row-reorder-highlight { background: rgba(32,171,226,.1) !important; }
  .row-reorder-hidden  { display: none; }
  .g-ghost-bar {
    position: absolute;
    height: 20px;
    border-radius: 2px;
    opacity: 0.3;
    pointer-events: none;
    z-index: 3;
  }
  .g-reorder-gap  {
    background: rgba(32,171,226,.12);
    border-top: 2px solid var(--blue);
    border-bottom: 1px solid var(--black);
    pointer-events: none;
  }

  /* Bars */
  .bar {
    position: absolute; top: 2px; height: 20px;
    border-radius: 2px; cursor: grab; display: flex; align-items: center;
    overflow: visible; user-select: none; z-index: 5; min-width: 6px;
    transition: filter .1s;
  }
  .bar:hover { filter: brightness(1.08); z-index: 6; }
  .bar:active { cursor: grabbing; }
  .bar-clipped { border-radius: 0 2px 2px 0; }
  .bar.hold::before {
    content: ''; position: absolute; inset: -1px;
    border: 2px dashed rgba(0,0,0,.4); border-radius: 3px; pointer-events: none;
  }
  .bar.estimate {
    clip-path: polygon(0 0, calc(100% - 11px) 0, 100% 50%, calc(100% - 11px) 100%, 0 100%);
  }
  .bar-handle {
    position: absolute; top: 0; bottom: 0; width: 7px; cursor: ew-resize; z-index: 5;
  }
  .bar-handle.lft { left: 0; border-radius: 2px 0 0 2px; }
  .bar-handle.rgt { right: 0; border-radius: 0 2px 2px 0; }

  /* Milestones (task-row) */
  .ms-dot {
    position: absolute; top: 50%; transform: translate(-50%, -50%);
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid var(--blue); background: #fff; z-index: 6; cursor: grab;
  }
  .ms-dot:active { cursor: grabbing; }
  .ms-lbl {
    position: absolute; top: 50%; transform: translateY(-50%);
    font-family: 'Barlow', sans-serif; font-weight: 600; font-size: 11px;
    color: var(--black); white-space: nowrap; padding-left: 10px; pointer-events: none;
  }

  /* Badges */
  .bdg {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 18px; height: 18px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 10px;
    color: #fff; z-index: 7; pointer-events: none;
  }
  .bdg-del { background: #D4804A; }

  /* Date popup */
  .dp-backdrop {
    position: fixed; inset: 0; z-index: 499; cursor: default;
  }
  .dp {
    position: fixed; background: #fff;
    border: 1px solid var(--lgray); border-radius: 4px;
    padding: 14px 16px 12px; box-shadow: 0 6px 22px rgba(0,0,0,.14);
    z-index: 500; font-family: 'Barlow Condensed', sans-serif; min-width: 210px;
  }
  .dp-close {
    position: absolute; top: 8px; right: 10px;
    cursor: pointer; color: var(--black); font-size: 14px; line-height: 1;
  }
  .dp-close:hover { color: var(--black); }
  .dp-task-name { font-weight: 700; font-size: 12px; margin-bottom: 10px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dp-extra { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
  .dp-extra input { flex: 1; }
  .dp-x { border: 0; background: none; cursor: pointer; font-size: 12px; color: var(--black); padding: 2px 4px; }
  .dp-add { border: 0; background: none; cursor: pointer; padding: 6px 0 0; font: inherit; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--blue); }
  .dp-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--black); margin-bottom: 3px; margin-top: 8px; }
  .dp input[type="date"] {
    width: 100%; border: 1px solid var(--lgray); border-radius: 2px;
    padding: 5px 8px; font-family: 'Barlow Condensed', sans-serif; font-size: 13px; outline: none;
  }
  .dp input[type="date"]:focus { border-color: var(--blue); }
  .dp-colors {
    display: flex; gap: 5px; margin-top: 4px;
  }
  .dp-shape { display: flex; gap: 5px; }
  .dp-shape button {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
    border: 1px solid var(--lgray); border-radius: 2px; background: #fff;
    padding: 4px 6px; cursor: pointer;
    font-family: 'Barlow Condensed', sans-serif; font-size: 12px; color: var(--black);
  }
  .dp-shape button.active { border-color: var(--blue); background: rgba(32,171,226,.1); }
  .dp-shape-bar { width: 16px; height: 7px; border-radius: 1px; background: var(--black); }
  .dp-shape-dot { width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--blue); }
  .dp-swatch {
    width: 22px; height: 22px; border-radius: 3px; cursor: pointer;
    border: 2px solid transparent; transition: transform .1s, border-color .1s;
  }
  .dp-swatch:hover { transform: scale(1.15); }
  .dp-swatch.dp-swatch-active { border-color: var(--black); }

  /* Touch: no long-press callout/selection on draggable marks; bigger grips & popup controls */
  .bar, .ms-dot, .ov-pill, .ov-approval { -webkit-touch-callout: none; -webkit-user-select: none; }
  @media (pointer: coarse) {
    .bar-handle { width: 12px; }
    .dp input[type="date"] { font-size: 16px; padding: 7px 8px; }
    .dp-swatch { width: 30px; height: 30px; }
    .dp-close { font-size: 18px; padding: 4px; top: 4px; right: 6px; }
  }

  @media print {
    .time-hdr    { position: relative; z-index: auto; }
    .gantt-scroll { overflow: hidden !important; }
    .dp          { display: none !important; }
    .gantt-inner { min-height: unset !important; }
  }
</style>
