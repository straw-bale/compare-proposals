<script>
  let {
    open             = false,
    projectId        = '',
    contentWidth     = 0,
    monthCount       = 0,
    showTodayDefault = true,
    onPrint,
    onClose,
  } = $props();

  const PAPERS = {
    letter:  { w: 1056, h: 816,  usableW: 979,  label: '8.5 × 11 in' },
    tabloid: { w: 1632, h: 1056, usableW: 1555, label: '11 × 17 in'  },
  };

  // Preview pane is up to 880px wide (narrower on small screens); iframe is the
  // full paper size scaled to fit. Below 760px the options stack under the preview.
  let innerW    = $state(window.innerWidth);
  let stacked   = $derived(innerW < 760);
  let PREVIEW_W = $derived(Math.max(240, Math.min(880, stacked ? innerW - 34 : innerW * 0.95 - 192)));

  let paper      = $state('tabloid');
  let showToday  = $state(true);
  let showLegend = $state(true);
  let iframeEl   = $state(null);

  $effect(() => {
    if (open) {
      showToday  = false;
      showLegend = true;
      paper      = 'tabloid';
    }
  });

  // Push option changes into the preview iframe via postMessage (no reload).
  $effect(() => {
    iframeEl?.contentWindow?.postMessage({ showToday, showLegend }, '*');
  });

  let pg          = $derived(PAPERS[paper]);
  let previewH    = $derived(Math.round(PREVIEW_W * (pg.h / pg.w)));
  let iframeScale = $derived(PREVIEW_W / pg.w);
  let scale       = $derived(contentWidth > 0 ? Math.min(1, pg.usableW / contentWidth) : 1);
  let scalePct    = $derived(Math.round(scale * 100));
  let fits        = $derived(scale >= 1);
  let iframeSrc   = $derived(projectId ? `${location.pathname}#schedule-print?paper=${paper}` : '');

  function handlePrint() {
    onPrint?.({ showToday, showLegend, paper });
  }

  function onIframeLoad() {
    // Re-send current options once the iframe finishes loading.
    iframeEl?.contentWindow?.postMessage({ showToday, showLegend }, '*');
  }
</script>

<svelte:window bind:innerWidth={innerW} onkeydown={(e) => { if (open && e.key === 'Escape') onClose?.(); }} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onmousedown={onClose} role="dialog">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="panel" onmousedown={(e) => e.stopPropagation()}>

      <!-- Header -->
      <div class="panel-hdr">
        <span class="panel-title">Print / Export PDF</span>
        <button class="close-btn" onclick={onClose} title="Close">✕</button>
      </div>

      <!-- Body: preview (left) + options (right) -->
      <div class="panel-body" class:stacked>

        <!-- Preview -->
        <div class="preview-col">
          <div class="preview-bg" style:width="{PREVIEW_W}px" style:height="{previewH}px">
            <div class="preview-paper"
              style:width="{PREVIEW_W}px"
              style:height="{previewH}px">
              {#if iframeSrc}
                <iframe
                  bind:this={iframeEl}
                  title="Print Preview"
                  class="preview-frame"
                  src={iframeSrc}
                  onload={onIframeLoad}
                  style:width="{pg.w}px"
                  style:height="{pg.h}px"
                  style:transform="scale({iframeScale})"
                ></iframe>
              {:else}
                <div class="preview-placeholder">No project selected</div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Options -->
        <div class="opts-col">

          <div class="section">
            <div class="section-label">Paper</div>
            <div class="paper-btns">
              {#each Object.entries(PAPERS) as [key, p]}
                <button
                  class="paper-btn"
                  class:paper-active={paper === key}
                  onclick={() => paper = key}
                >{p.label}</button>
              {/each}
            </div>
          </div>

          <div class="divider"></div>

          <div class="section">
            <div class="section-label">Schedule</div>
            <div class="info-row">
              <span class="info-key">Months</span>
              <span class="info-val">{monthCount}</span>
            </div>
            <div class="info-row">
              <span class="info-key">Scale</span>
              <span class="info-val" class:scale-full={fits} class:scale-down={!fits}>
                {fits ? 'Full size' : `${scalePct}%`}
              </span>
            </div>
          </div>

          <div class="divider"></div>

          <div class="section">
            <div class="section-label">Include</div>
            <label class="opt-row">
              <input type="checkbox" bind:checked={showToday} />
              <span class="opt-lbl">Today marker</span>
            </label>
            <label class="opt-row">
              <input type="checkbox" bind:checked={showLegend} />
              <span class="opt-lbl">Legend</span>
            </label>
          </div>

        </div>
      </div>

      <!-- Footer -->
      <div class="panel-foot">
        <button class="btn-cancel" onclick={onClose}>Cancel</button>
        <button class="btn-print" onclick={handlePrint}>Print to PDF →</button>
      </div>

    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 500;
    background: rgba(0,0,0,.4);
    display: flex; align-items: center; justify-content: center;
  }

  .panel {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 4px;
    box-shadow: 0 12px 40px rgba(0,0,0,.22);
    display: flex; flex-direction: column;
    font-family: 'Barlow Condensed', sans-serif;
    max-width: 95vw;
    max-height: 90vh;
    overflow: hidden;
  }

  .panel-hdr {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--lgray);
    flex-shrink: 0;
  }
  .panel-title {
    font-weight: 700; font-size: 12px;
    text-transform: uppercase; letter-spacing: .1em;
    color: var(--black);
  }
  .close-btn {
    background: none; border: none; cursor: pointer;
    color: var(--black); font-size: 13px; line-height: 1; padding: 0;
    transition: color .12s;
  }
  .close-btn:hover { color: var(--black); }

  /* Body row */
  .panel-body {
    display: flex;
    flex-direction: row;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Preview column */
  .preview-col {
    flex-shrink: 0;
    border-right: 1px solid var(--lgray);
  }
  .preview-bg {
    background: #e8e8e8;
    display: flex; align-items: flex-start; justify-content: center;
    padding: 0;
    overflow: hidden;
  }
  .preview-paper {
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 2px 12px rgba(0,0,0,.2);
  }
  .preview-frame {
    border: none; display: block;
    transform-origin: top left;
  }
  .preview-placeholder {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 100%;
    font-size: 11px; color: var(--black);
  }

  /* Options column */
  .opts-col {
    width: 190px;
    flex-shrink: 0;
    padding: 16px 14px;
    display: flex; flex-direction: column; gap: 14px;
    overflow-y: auto;
  }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-label {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .13em;
    color: var(--black); margin-bottom: 2px;
  }

  /* Paper size buttons */
  .paper-btns { display: flex; flex-direction: column; gap: 4px; }
  .paper-btn {
    font-family: 'Barlow', sans-serif;
    font-weight: 600; font-size: 11px;
    text-align: left;
    background: #fff; border: 1px solid var(--lgray);
    border-radius: 3px; padding: 5px 9px;
    color: var(--black); cursor: pointer;
    transition: border-color .12s, color .12s, background .12s;
  }
  .paper-btn:hover:not(.paper-active) {
    border-color: #bbb; color: var(--black);
  }
  .paper-active {
    border-color: var(--black); color: var(--black);
    background: var(--off);
  }

  .divider { height: 1px; background: var(--lgray); }

  .info-row {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 12px;
  }
  .info-key { color: var(--black); }
  .info-val { color: var(--black); font-weight: 600; }
  .scale-full { color: #3B8FA0; }
  .scale-down { color: #9E9068; }

  .opt-row {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--black);
    cursor: pointer; user-select: none; padding: 2px 0;
  }
  .opt-row input[type="checkbox"] {
    width: 14px; height: 14px; cursor: pointer;
    accent-color: var(--blue); flex-shrink: 0;
  }
  .opt-lbl { font-weight: 500; }

  /* Narrow screens: options below the preview, whole body scrolls */
  .panel-body.stacked { flex-direction: column; overflow-y: auto; }
  .stacked .preview-col { border-right: none; border-bottom: 1px solid var(--lgray); }
  .stacked .opts-col { width: auto; overflow: visible; }
  .stacked .paper-btns { flex-direction: row; }
  .stacked .paper-btn { flex: 1; text-align: center; padding: 9px; }

  @media (pointer: coarse) {
    .opt-row input[type="checkbox"] { width: 20px; height: 20px; }
    .opt-row { font-size: 14px; padding: 6px 0; }
    .btn-cancel, .btn-print { padding: 11px 16px; }
    .close-btn { font-size: 18px; padding: 4px; margin: -4px; }
  }

  /* Footer */
  .panel-foot {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px 14px;
    border-top: 1px solid var(--lgray);
    flex-shrink: 0;
  }
  .btn-cancel {
    font-family: 'Barlow', sans-serif;
    font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: .1em;
    background: none; border: 1px solid var(--lgray);
    color: var(--black); border-radius: 3px;
    padding: 7px 14px; cursor: pointer;
    transition: border-color .12s, color .12s;
  }
  .btn-cancel:hover { border-color: #aaa; color: var(--black); }
  .btn-print {
    font-family: 'Barlow', sans-serif;
    font-weight: 700; font-size: 11px;
    text-transform: uppercase; letter-spacing: .1em;
    background: var(--black); border: 1px solid var(--black);
    color: #fff; border-radius: 3px;
    padding: 7px 16px; cursor: pointer;
    transition: background .12s, border-color .12s;
  }
  .btn-print:hover { background: var(--blue); border-color: var(--blue); }
</style>
