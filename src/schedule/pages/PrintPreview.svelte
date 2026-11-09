<script>
  import { onMount, tick } from 'svelte';
  import TaskPanel    from '../lib/components/TaskPanel.svelte';
  import GanttPanel   from '../lib/components/GanttPanel.svelte';
  import LegendFooter from '../lib/components/LegendFooter.svelte';
  import { parseDate, toISO, monthList } from '../lib/utils/dates.js';

  let { data } = $props();
  let markerLanes = $state(1); // stacked marker lanes reported by GanttPanel

  const TASK_COL_W = 252;
  const USABLE_W   = { letter: 979, tabloid: 1555 };

  let project    = $state(null);
  let showToday  = $state(data.autoprint ? data.showToday  : true);
  let showLegend = $state(data.autoprint ? data.showLegend : true);

  let ganttMonths = $derived(project
    ? monthList(parseDate(project.viewStart), parseDate(project.viewEnd))
    : []);

  // Fit columns to the usable paper width — only changes column width, not row height,
  // so content never overflows vertically onto an extra page.
  let usableW  = $derived(USABLE_W[data.paper] ?? 979);
  let colW     = $derived(ganttMonths.length > 0
    ? Math.max(20, Math.floor((usableW - TASK_COL_W) / ganttMonths.length))
    : 72);
  let contentW = $derived(TASK_COL_W + ganttMonths.length * colW);

  const noop = () => {};

  onMount(async () => {
    const raw = sessionStorage.getItem('r3a_preview');
    if (raw) {
      try { project = JSON.parse(raw); } catch {}
    }
    window.addEventListener('message', (e) => {
      if (typeof e.data?.showToday  === 'boolean') showToday  = e.data.showToday;
      if (typeof e.data?.showLegend === 'boolean') showLegend = e.data.showLegend;
    });

    if (data.autoprint) {
      if (data.title) document.title = data.title;
      await tick();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.print();
        window.close();
      }));
    }
  });

</script>

{#if project}
  <div class="preview-pg" style:min-width="{contentW}px">

    <header class="preview-hdr">
      <div class="preview-title">{project.title || 'Project Title'}</div>
      {#if project.date || project.number || project.client}
        <div class="preview-meta">
          {#each [project.date, project.number, project.client].filter(Boolean) as v, i}
            {#if i > 0}<span class="meta-sep">·</span>{/if}
            <span class="meta-item">{v}</span>
          {/each}
        </div>
      {/if}
    </header>

    <div class="preview-body">
      <div class="preview-inner" style:width="{contentW}px" style:min-width="{contentW}px">
        <TaskPanel
          markerLanes={markerLanes}
          tasks={project.tasks}
          onRename={noop}
          onDelete={noop}
          onReorder={noop}
          onAdd={noop}
          highlightId={null}
          zoom="month"
        />
        <GanttPanel
          bind:markerLanes
          tasks={project.tasks}
          viewStart={project.viewStart}
          viewEnd={project.viewEnd}
          todayMark={toISO(new Date())}
          legend={project.legend}
          dropDate={null}
          highlightTaskId={null}
          onTaskUpdate={noop}
          onLegendItemUpdate={noop}
          onDraggingChange={noop}
          zoom="month"
          colWOverride={colW}
          showTodayLine={showToday}
        />
      </div>
    </div>

    {#if showLegend}
      <LegendFooter
        legend={project.legend}
        tasks={project.tasks}
        notes={project.notes ?? ''}
        onUpdate={noop}
      />
    {/if}

  </div>
  <!-- Block all interaction so preview is read-only -->
  <div class="blocker"></div>

{:else}
  <div class="loading">Loading preview…</div>
{/if}

<style>
  :global(html.schedule-full, html.schedule-full body) { margin: 0; padding: 0; background: #fff; overflow: hidden; height: 100%; }

  .preview-pg {
    display: flex;
    flex-direction: column;
    background: #fff;
    min-width: 0;
    min-height: 100vh;
  }

  .preview-hdr {
    padding: 10px 18px 8px;
    border-bottom: 2px solid var(--black);
    background: #fff;
    flex-shrink: 0;
  }
  .preview-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800; font-size: 22px;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--black); line-height: 1.1;
  }
  .preview-meta {
    display: flex; flex-direction: row; align-items: center;
    flex-wrap: wrap; gap: 0; margin-top: 5px;
  }
  .meta-item {
    font-family: 'Barlow', sans-serif;
    font-size: 11px; color: var(--black);
  }
  .meta-sep {
    font-size: 11px; color: var(--black); padding: 0 5px; user-select: none;
  }

  .preview-body { overflow: visible; flex: 1; }
  .preview-inner { display: flex; }

  .blocker {
    position: fixed; inset: 0; z-index: 9999;
    background: transparent;
  }

  .loading {
    display: flex; align-items: center; justify-content: center;
    height: 300px;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px; color: var(--black);
  }

  @media print {
    :global(html.schedule-full, html.schedule-full body) { overflow: visible !important; height: auto !important; }
    .blocker { display: none !important; }
    .preview-pg { min-height: 0 !important; }
  }
</style>
