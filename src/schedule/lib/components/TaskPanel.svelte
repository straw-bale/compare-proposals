<script>
  import { pointerDrag } from '../utils/pointer.js';

  const ROW_H = 26;

  let { tasks, onRename, onDelete, onReorder, onAdd, onDragChange, highlightId = null, zoom = 'month', markerLanes = 1, width = 252, readonly = false } = $props();

  // monthly: year(18) + month(28) + markers(22) = 68px
  // biweek/week: year(18) + mspan(28) + col(22) + markers(22) = 90px
  // Each extra marker lane (stacked overlapping markers) adds 18px
  let hdrH = $derived((zoom === 'month' ? 60 : 82) + (markerLanes - 1) * 18);

  function initRowDrag(handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();

      const list    = handle.closest('.task-list');
      const rowEl   = handle.closest('.t-row');
      const rowRect = rowEl.getBoundingClientRect();
      const draggingTaskId = Number(rowEl.dataset.id);

      // Signal highlight immediately on mousedown (no position yet — just lights up the row)
      onDragChange?.(draggingTaskId, null);
      let insertAt = -1;

      let dragActivated = false;
      let ghost  = null;
      let spacer = null;

      function activate() {
        const allRows = [...list.querySelectorAll('.t-row')];
        insertAt = allRows.indexOf(rowEl);
        onDragChange?.(draggingTaskId, insertAt);

        ghost = document.createElement('div');
        ghost.className = 't-ghost';
        ghost.style.cssText = `top:${rowRect.top}px;left:${rowRect.left}px;width:${rowRect.width}px;height:${ROW_H}px;`;
        ghost.textContent = rowEl.querySelector('.t-name').textContent;
        document.body.appendChild(ghost);

        spacer = document.createElement('div');
        spacer.className = 't-drop-spacer';

        rowEl.style.display = 'none';
        rowEl.after(spacer);
        dragActivated = true;
      }

      function visibleRows() {
        return [...list.querySelectorAll('.t-row')].filter(el => el !== rowEl);
      }

      function updateSpacerPos(clientY) {
        const rows = visibleRows();
        let newInsert = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (clientY < r.top + r.height / 2) { newInsert = i; break; }
        }
        if (newInsert === insertAt) return;
        insertAt = newInsert;
        spacer.remove();
        if (insertAt >= rows.length) list.appendChild(spacer);
        else rows[insertAt].before(spacer);
        onDragChange?.(draggingTaskId, insertAt);
      }

      function move(ev) {
        if (!dragActivated) {
          if (Math.abs(ev.clientY - e.clientY) < 4) return;
          activate();
        }
        ghost.style.top = (rowRect.top + ev.clientY - e.clientY) + 'px';
        updateSpacerPos(ev.clientY);
      }

      function end() {
        onDragChange?.(null, null);
        if (!dragActivated) return;
        ghost.remove();
        spacer.remove();
        rowEl.style.display = '';
        const allRows = [...list.querySelectorAll('.t-row')];
        const taskIdx = allRows.indexOf(rowEl);
        if (insertAt !== taskIdx) onReorder(taskIdx, insertAt);
      }

      // Handle has touch-action: none, so touch drags start immediately
      pointerDrag(e, { holdMs: 0, onMove: move, onEnd: end, onTap: end });
    });
  }

  function mountDrag(el) { initRowDrag(el); }
</script>


<div class="task-panel" class:readonly style:width="{width}px">
  <div class="col-hdr-lbl" style:height="{hdrH}px">Tasks</div>

  <div class="task-list">
    {#each tasks as task, i (task.id)}
      <div class="t-row" class:t-highlight={task.id === highlightId} data-id={task.id}>
        {#if !readonly}
          <div class="t-drag" title="Drag to reorder" use:mountDrag>⠿</div>
        {/if}

        <div
          class="t-name"
          contenteditable={!readonly}
          spellcheck="false"
          onblur={(e) => onRename(task.id, e.target.textContent.trim() || task.name)}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
        >{task.name}</div>
        {#if !readonly}
          <div class="t-del no-print" title="Remove" onclick={() => onDelete(task.id)}>✕</div>
        {/if}
      </div>
    {/each}
  </div>

  {#if !readonly}
    <div class="add-btn no-print" onclick={onAdd}>+ Add Task</div>
  {/if}
</div>

<style>
  .task-panel {
    flex-shrink: 0;
    border-right: 2px solid var(--black);
    display: flex;
    flex-direction: column;
    background: #fff;
    z-index: 20;
    position: sticky;
    left: 0;
  }
  .col-hdr-lbl {
    display: flex;
    align-items: flex-end;
    padding: 0 12px 8px;
    font-family: 'Barlow', sans-serif;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .13em;
    color: var(--black);
    border-bottom: 1px solid var(--black);
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 21;
    background: #fff;
  }
  .task-list { position: relative; }
  .t-row {
    height: 26px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    border-bottom: 1px solid var(--black);
    gap: 5px;
    transition: background .1s;
    position: relative;
  }
  .t-row:hover { background: rgba(32,171,226,.04); }
  .t-row:has(.t-drag:active) { background: rgba(32,171,226,.1) !important; }
  .t-row.dragging { display: none; }
  .t-highlight { background: rgba(0,0,0,.06) !important; }

  .t-drag {
    opacity: 0;
    color: var(--black);
    font-size: 13px;
    cursor: grab;
    flex-shrink: 0;
    padding: 0 2px 0 0;
    transition: opacity .12s;
    user-select: none;
    letter-spacing: -1px;
  }
  .t-row:hover .t-drag { opacity: 1; }
  .t-drag:hover { color: var(--black); }
  .t-drag:active { cursor: grabbing; }
  .t-drag { touch-action: none; -webkit-touch-callout: none; }
  .readonly .t-name { cursor: default; }

  .t-name {
    flex: 1;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
    /* Wrap long names onto a second line (fits the 26px row), clamp beyond that */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    outline: none;
    cursor: text;
    line-height: 1.1;
  }
  .t-name:focus {
    display: block;
    -webkit-line-clamp: unset;
    line-clamp: unset;
    overflow: visible;
    position: relative;
    z-index: 2;
    background: #eaf6fc;
    border-radius: 2px;
    padding: 1px 4px;
  }
  .t-del {
    opacity: 0;
    font-size: 12px;
    color: var(--black);
    cursor: pointer;
    flex-shrink: 0;
    padding: 2px 3px;
    transition: opacity .12s, color .12s;
  }
  .t-row:hover .t-del { opacity: 1; }
  .t-del:hover { color: var(--mag); }

  .add-btn {
    padding: 7px 12px;
    font-family: 'Barlow', sans-serif;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--blue);
    cursor: pointer;
    border-top: 1px solid var(--lgray);
    flex-shrink: 0;
    transition: background .12s;
  }
  .add-btn:hover { background: rgba(32,171,226,.06); }

  :global(.t-ghost) {
    position: fixed;
    background: #fff;
    border-left: 3px solid var(--blue);
    box-shadow: 0 4px 16px rgba(0,0,0,.18);
    pointer-events: none;
    z-index: 999;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
  }
  :global(.t-drop-spacer) {
    height: 26px;
    background: rgba(32,171,226,.08);
    border-left: 3px solid var(--blue);
    border-bottom: 1px solid var(--lgray);
    pointer-events: none;
    flex-shrink: 0;
  }

  /* Touch screens have no hover — keep row controls visible and easier to hit */
  @media (hover: none) {
    .t-drag, .t-del { opacity: .45; }
    .t-row { padding: 0 6px; gap: 3px; }
    .t-drag { padding: 4px 4px 4px 2px; font-size: 14px; }
    .t-del  { padding: 4px 5px; }
    .add-btn { padding: 11px 12px; }
  }

  @media print {
    .task-panel  { position: relative; }
    .col-hdr-lbl { position: relative; }
    .t-drag      { display: none !important; }
  }
</style>
