<script>
  import { onMount, tick } from 'svelte';
  import TaskPanel    from '../lib/components/TaskPanel.svelte';
  import GanttPanel   from '../lib/components/GanttPanel.svelte';
  import LegendFooter from '../lib/components/LegendFooter.svelte';
  import { parseDate, toISO, monthList } from '../lib/utils/dates.js';

  let { data } = $props();
  let markerLanes = $state(1); // stacked marker lanes reported by GanttPanel

  const TASK_COL_W = 252;
  // Printable area in CSS pixels (96 per inch): the sheet less 0.5in margins at the sides and 0.4in top and bottom.
  // 8.5 × 11 prints portrait (more room for the legend), 11 × 17 landscape; both are 11in tall.
  const USABLE = { letter: { w: 720, h: 979 }, tabloid: { w: 1536, h: 979 } };
  // Named sizes with an orientation (not bare measurements), so printer drivers and PDF printers turn the sheet
  // too, not just the browser. Added after the schedule's shared print rules. "ledger" is CSS for 11 × 17 paper.
  const PAGE_SIZE  = { letter: 'letter portrait', tabloid: 'ledger landscape' };

  let project    = $state(null);
  let showToday  = $state(data.autoprint || data.pdf ? data.showToday  : true);
  let showLegend = $state(data.autoprint || data.pdf ? data.showLegend : true);

  let ganttMonths = $derived(project
    ? monthList(parseDate(project.viewStart), parseDate(project.viewEnd))
    : []);

  // Always one page: when the schedule (with its legend) is taller than the printable area, everything is scaled
  // down to fit (fit < 1), and the month columns are widened to use the full width again at that scale.
  let usable   = $derived(USABLE[data.paper] ?? USABLE.letter);
  let fit      = $state(1);
  let fitted   = $state(false); // the server's PDF waits for this
  let contentEl = $state(null);
  let colW     = $derived(ganttMonths.length > 0
    ? Math.max(12, Math.floor((usable.w / fit - TASK_COL_W) / ganttMonths.length))
    : 72);
  let contentW = $derived(TASK_COL_W + ganttMonths.length * colW);

  // Measures the content at full size and sets the scale; again whenever the legend or markers change its height.
  $effect(() => {
    void [project, showLegend, showToday, markerLanes];
    if (!contentEl) return;
    let cancelled = false;
    (async () => {
      fit = 1;
      await tick();
      await document.fonts?.ready;
      if (cancelled || !contentEl) return;
      const h = contentEl.scrollHeight;
      fit = h > usable.h ? Math.floor((usable.h / h) * 1000) / 1000 : 1;
      await tick();
      fitted = true;
    })();
    return () => { cancelled = true; };
  });

  const noop = () => {};

  // Option changes from the print panel (this site only); the listener goes when the preview closes.
  onMount(() => {
    const onMessage = (e) => {
      if (e.origin !== location.origin) return;
      if (typeof e.data?.showToday  === 'boolean') showToday  = e.data.showToday;
      if (typeof e.data?.showLegend === 'boolean') showLegend = e.data.showLegend;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  onMount(() => {
    const page = document.createElement('style');
    page.id = 'schedule-print-page';
    page.textContent = `@media print { @page { size: ${PAGE_SIZE[data.paper] ?? PAGE_SIZE.letter}; margin: 0.4in 0.5in; } }`;
    document.head.appendChild(page);
    return () => page.remove();
  });

  onMount(async () => {
    const raw = sessionStorage.getItem('r3a_preview');
    if (raw) {
      try { project = JSON.parse(raw); } catch {}
    }


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
  <div class="preview-pg">
  <div class="preview-content" bind:this={contentEl} style:zoom={fit} style:width="{contentW}px" data-fitted={fitted ? '1' : null}>

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
        readonly
      />
    {/if}

  </div>
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

  /* On screen (the print panel's preview), show the sheet with the same margins the printer adds, so the preview
     matches the printed page: the timeline is sized to the area inside them. */
  @media screen {
    .preview-pg { box-sizing: border-box; padding: 0.4in 0.5in; }
  }

  /* On paper, long legend names wrap onto a second line instead of being cut off with "…". */
  .preview-content :global(.leg-name) { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }

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
