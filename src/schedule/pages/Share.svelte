<script>
  import { onMount } from 'svelte';
  import TaskPanel    from '../lib/components/TaskPanel.svelte';
  import GanttPanel   from '../lib/components/GanttPanel.svelte';
  import LegendFooter from '../lib/components/LegendFooter.svelte';
  import { listSchedules } from '../../store';
  import { normalizeProject } from '../lib/stores/projects.js';
  import { parseDate, toISO, monthList } from '../lib/utils/dates.js';

  let { data } = $props();
  let markerLanes = $state(1); // stacked marker lanes reported by GanttPanel

  const noop = () => {};

  let project  = $state(null);
  let loading  = $state(true);
  let notFound = $state(false);

  let ganttMonths = $derived(project
    ? monthList(parseDate(project.viewStart), parseDate(project.viewEnd))
    : []);

  // Fit the schedule to the window width, respecting a min column width
  let windowW  = $state(typeof window !== 'undefined' ? window.innerWidth : 1200);
  let isPhone    = $derived(windowW < 640);
  let TASK_COL_W = $derived(isPhone ? 124 : 252);
  let colW     = $derived(ganttMonths.length > 0
    ? Math.max(36, Math.floor((windowW - TASK_COL_W) / ganttMonths.length))
    : 72);
  let contentW = $derived(TASK_COL_W + ganttMonths.length * colW);

  // When the timeline is wider than the screen, hint that it scrolls sideways
  let bodyEl      = $state(null);
  let scrollLeft  = $state(0);
  let overflows   = $derived(contentW > windowW + 1);
  let atEnd       = $derived(scrollLeft + windowW >= contentW - 4);

  onMount(async () => {
    window.addEventListener('resize', () => { windowW = window.innerWidth; });

    const row = (await listSchedules()).find(s => s.id === data.id);

    loading = false;
    if (!row) { notFound = true; return; }
    project = normalizeProject(row);
  });
</script>

<svelte:head>
  <title>{project?.title ? `${project.title} — Schedule` : 'Schedule'}</title>
</svelte:head>

{#if loading}
  <div class="state-screen">Loading…</div>
{:else if notFound}
  <div class="state-screen">Schedule not found.</div>
{:else if project}
  <div class="share-page">

    <header class="share-hdr">
      <div class="hdr-left">
        <div class="share-title">{project.title || 'Project Schedule'}</div>
        <div class="share-meta">
          {#each [project.date, project.number, project.client].filter(Boolean) as v, i}
            {#if i > 0}<span class="meta-sep">·</span>{/if}
            <span class="meta-item">{v}</span>
          {/each}
        </div>
      </div>
      <div class="share-badge">Draft</div>
    </header>

    {#if overflows}
      <div class="swipe-hint">Swipe sideways to see the full timeline →</div>
    {/if}

    <div class="share-body" class:fade-right={overflows && !atEnd}
         bind:this={bodyEl} onscroll={() => scrollLeft = bodyEl.scrollLeft}>
      <div class="share-inner" style:width="{contentW}px">
        <TaskPanel
          readonly
          width={TASK_COL_W}
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
          showTodayLine={true}
        />
      </div>
    </div>

    <LegendFooter
      readonly
      legend={project.legend}
      tasks={project.tasks}
      notes={project.notes ?? ''}
      onUpdate={noop}
    />


  </div>
{/if}

<style>
  :global(html.schedule-full, html.schedule-full body) { margin: 0; padding: 0; background: #fff; }

  .state-screen {
    display: flex; align-items: center; justify-content: center;
    height: calc(100vh - var(--site-header-h, 0px));
    font-family: 'Barlow Condensed', sans-serif; font-size: 14px; color: var(--black);
  }

  .share-page {
    display: flex; flex-direction: column;
    min-height: calc(100vh - var(--site-header-h, 0px));
    background: #fff;
    overflow-x: auto;
  }

  .share-hdr {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 10px 18px 8px;
    border-bottom: 2px solid var(--black);
    flex-shrink: 0;
    background: #fff;
    gap: 16px;
  }
  .hdr-left { min-width: 0; }
  .share-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800; font-size: 22px;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--black); line-height: 1.1;
  }
  .share-meta {
    display: flex; align-items: center; gap: 2px;
    margin-top: 5px; flex-wrap: wrap;
  }
  .meta-sep {
    font-size: 11px; color: var(--black); padding: 0 4px;
  }
  .meta-item {
    font-family: 'Barlow', sans-serif;
    font-size: 11px; color: var(--black);
  }
  .share-badge {
    flex-shrink: 0;
    background: var(--off, #f5f5f5);
    border: 1px solid var(--lgray, #e0e0e0);
    border-radius: 3px;
    font-family: 'Barlow', sans-serif;
    font-weight: 700; font-size: 11px;
    text-transform: uppercase; letter-spacing: .12em;
    color: var(--black);
    padding: 4px 10px;
    align-self: center;
  }

  .share-body { overflow-x: auto; flex: 1; position: relative; }

  .swipe-hint {
    font-family: 'Barlow', sans-serif; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .08em;
    color: var(--blue); background: var(--off);
    padding: 6px 12px; border-bottom: 1px solid var(--lgray);
  }
  /* Soft edge on the right while more timeline is off-screen */
  .fade-right {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
            mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  }
  .share-inner { display: flex; overflow-x: clip; } /* clip markers past the end; clip keeps the sticky task column working */

  /* Read-only: content ignores pointers (no dragging/editing), while the scroll
     containers themselves still receive touches so the schedule can be panned */
  .share-inner :global(*), .share-page :global(.legend *) { pointer-events: none; }

  @media screen and (max-width: 640px) {
    .share-hdr   { padding: 10px 12px; align-items: center; }
    .share-title { font-size: 18px; }
    .share-badge { padding: 3px 8px; }
    /* Legend follows the schedule directly instead of being pushed to the page bottom */
    .share-body  { flex: none; }
  }
</style>
