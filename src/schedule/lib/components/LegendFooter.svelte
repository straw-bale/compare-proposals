<script>
  import { tick } from 'svelte';
  import { toWeekday } from '../utils/dates.js';

  let { legend, tasks = [], onUpdate, onMilestoneDrag, onApprovalDrag, onEstimateDrag, onAddMilestone, onAddDeliverable, onAddApproval, onAddEstimate, onLinkClick, notes = '', onNotesUpdate = null, readonly = false } = $props();

  function emit(section, items) {
    onUpdate(section, items);
  }

  function updateField(section, idx, field, val) {
    emit(section, legend[section].map((item, i) => i === idx ? { ...item, [field]: val } : item));
  }

  function removeItem(section, idx) {
    emit(section, legend[section].filter((_, i) => i !== idx));
  }

  function onText(e, section, idx, field) {
    updateField(section, idx, field, e.target.textContent.trim());
  }
  function onColor(e, section, idx) {
    updateField(section, idx, 'color', e.target.value);
  }
  function onDate(e, section, idx) {
    const date = toWeekday(e.target.value) || null;
    if (date) e.target.value = date;
    updateField(section, idx, 'date', date);
  }

  // Notes are stored as one string, one note per line, and shown as a numbered list.
  let noteItems = $derived(notes.split('\n').map(n => n.trim()).filter(Boolean));
  let draftNote = $state(false);  // an empty row being typed into (blank notes aren't saved)
  let notesEl   = $state(null);

  function saveNotes(items) {
    onNotesUpdate?.(items.map(n => n.trim()).filter(Boolean).join('\n'));
  }
  function onNoteBlur(e, idx) {
    const items = [...noteItems];
    items[idx] = e.target.textContent;
    saveNotes(items);
  }
  function onDraftBlur(e) {
    saveNotes([...noteItems, e.target.textContent]);
    e.target.textContent = '';
    draftNote = false;
  }
  // Enter commits the note; on the last note it also starts a new one
  function onNoteKey(e, isLast) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const hasText = !!e.target.textContent.trim();
    e.target.blur();
    if (isLast && hasText) addNote();
  }
  async function addNote() {
    draftNote = true;
    await tick();
    notesEl?.querySelector('.note-draft')?.focus();
  }
  function removeNote(idx) {
    saveNotes(noteItems.filter((_, i) => i !== idx));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[Number(m)-1]} ${Number(d)}, ${y}`;
  }
</script>

<footer class="legend" class:readonly>

  <!-- Deliverables -->
  <div class="leg-col">
    <div class="leg-hdr">Deliverables</div>
    <div class="leg-items">
      {#each legend.deliverables as d, i}
        {@const num = i + 1}
        <div class="leg-row">
          <div class="leg-bdg" style:background="#D4804A">{num}</div>
          <div class="leg-body">
            <div class="leg-line">
              <span
                class="leg-field leg-name"
                contenteditable={!readonly}
                spellcheck="false"
                onblur={(e) => onText(e, 'deliverables', i, 'text')}
                onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.target.blur())}
              >{d.text}</span>
            </div>
            <div class="leg-sub">
              <input
                type="date"
                class="date-inp no-print"
                value={d.date ?? ''}
                onchange={(e) => onDate(e, 'deliverables', i)}
              >
              <span class="date-print print-only">{fmtDate(d.date)}</span>
            </div>
          </div>
          <button class="leg-del" onclick={() => removeItem('deliverables', i)}>✕</button>
        </div>
      {/each}
      <button type="button" class="leg-add"
        onclick={(e) => onAddDeliverable?.(e)}
        title="Click to add, then click on schedule to place">+ Add</button>
    </div>
  </div>

  <!-- Milestones -->
  <div class="leg-col">
    <div class="leg-hdr">Milestones</div>
    <div class="leg-items">
      {#each legend.milestones as m, i}
        <div class="leg-row">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="ms-pill"
            title="Drag to schedule"
            onpointerdown={(e) => onMilestoneDrag?.(m, e)}
          >
            <span
              contenteditable={!readonly}
              spellcheck="false"
              onblur={(e) => onText(e, 'milestones', i, 'code')}
              onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.target.blur())}
              onpointerdown={(e) => e.stopPropagation()}
            >{m.code}</span>
          </div>
          <div class="leg-body">
            <div class="leg-line">
              <span
                class="leg-field leg-name"
                contenteditable={!readonly}
                spellcheck="false"
                onblur={(e) => onText(e, 'milestones', i, 'text')}
                onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.target.blur())}
              >{m.text}</span>
            </div>
            <div class="leg-sub">
              <input
                type="date"
                class="date-inp no-print"
                value={m.date ?? ''}
                onchange={(e) => onDate(e, 'milestones', i)}
              >
              <span class="date-print print-only">{fmtDate(m.date)}</span>
            </div>
          </div>
          <button class="leg-del" onclick={() => removeItem('milestones', i)}>✕</button>
        </div>
      {/each}
      <button type="button" class="leg-add"
        onclick={(e) => onAddMilestone?.(e)}
        title="Click to add, then click on schedule to place">+ Add</button>
    </div>
  </div>

  <!-- Estimates -->
  <div class="leg-col">
    <div class="leg-hdr">Estimates</div>
    <div class="leg-items">
      {#each legend.estimates as e, i}
        <div class="leg-row">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="leg-code"
            style:background={e.color}
            title="Drag to schedule"
            onpointerdown={(ev) => onEstimateDrag?.(e, ev)}
          >
            <span
              contenteditable={!readonly}
              spellcheck="false"
              onblur={(ev) => onText(ev, 'estimates', i, 'code')}
              onkeydown={(ev) => ev.key === 'Enter' && (ev.preventDefault(), ev.target.blur())}
              onpointerdown={(ev) => ev.stopPropagation()}
            >{e.code}</span>
          </div>
          <div class="leg-body">
            <div class="leg-line">
              <span
                class="leg-field leg-name"
                contenteditable={!readonly}
                spellcheck="false"
                onblur={(ev) => onText(ev, 'estimates', i, 'text')}
                onkeydown={(ev) => ev.key === 'Enter' && (ev.preventDefault(), ev.target.blur())}
              >{e.text}</span>
            </div>
            <div class="leg-sub">
              <input
                type="date"
                class="date-inp no-print"
                value={e.date ?? ''}
                onchange={(ev) => onDate(ev, 'estimates', i)}
              >
              <span class="date-print print-only">{fmtDate(e.date)}</span>
            </div>
          </div>
          <button class="leg-del" onclick={() => removeItem('estimates', i)}>✕</button>
        </div>
      {/each}
      <button type="button" class="leg-add"
        onclick={(e) => onAddEstimate?.(e)}
        title="Click to add, then click on schedule to place">+ Add</button>
    </div>
  </div>

  <!-- Approvals -->
  <div class="leg-col">
    <div class="leg-hdr">Approvals</div>
    <div class="leg-items">
      {#each legend.approvals as a, i}
        <div class="leg-row">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="leg-diamond"
            title="Drag to schedule"
            onpointerdown={(e) => onApprovalDrag?.(a, e)}
          ></div>
          <div class="leg-body">
            <div class="leg-line">
              <span
                class="leg-field leg-name"
                contenteditable={!readonly}
                spellcheck="false"
                onblur={(e) => onText(e, 'approvals', i, 'text')}
                onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.target.blur())}
              >{a.text}</span>
            </div>
            <div class="leg-sub">
              <input
                type="date"
                class="date-inp no-print"
                value={a.date ?? ''}
                onchange={(e) => onDate(e, 'approvals', i)}
              >
              <span class="date-print print-only">{fmtDate(a.date)}</span>
            </div>
          </div>
          <button class="leg-del" onclick={() => removeItem('approvals', i)}>✕</button>
        </div>
      {/each}
      <button type="button" class="leg-add"
        onclick={(e) => onAddApproval?.(e)}
        title="Click to add, then click on schedule to place">+ Add</button>
    </div>
  </div>

  <!-- Notes -->
  <div class="leg-col leg-col-notes">
    <div class="leg-hdr">Notes</div>
    <div class="leg-items" bind:this={notesEl}>
      {#each noteItems as n, i (i + ':' + n)}
        <div class="leg-row note-row">
          <span class="note-num">{i + 1}.</span>
          <span
            class="leg-field note-txt"
            role="textbox"
            tabindex="0"
            contenteditable={!!onNotesUpdate}
            spellcheck="false"
            onblur={(e) => onNoteBlur(e, i)}
            onkeydown={(e) => onNoteKey(e, i === noteItems.length - 1)}
          >{n}</span>
          {#if onNotesUpdate}
            <button class="leg-del" onclick={() => removeNote(i)}>✕</button>
          {/if}
        </div>
      {/each}
      {#if draftNote}
        <div class="leg-row note-row">
          <span class="note-num">{noteItems.length + 1}.</span>
          <span
            class="leg-field note-txt note-draft"
            role="textbox"
            tabindex="0"
            contenteditable={!readonly}
            spellcheck="false"
            onblur={onDraftBlur}
            onkeydown={(e) => onNoteKey(e, true)}
          ></span>
        </div>
      {/if}
      {#if onNotesUpdate}
        <button type="button" class="leg-add" onclick={addNote}>+ Add</button>
      {/if}
    </div>
  </div>

</footer>

<style>
  .legend {
    border-top: 1.5px solid var(--black);
    display: flex;
    flex-shrink: 0;
  }
  .leg-col {
    flex: 1;
    border-right: 1px solid var(--black);
    overflow: hidden;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .leg-col:last-child { border-right: none; }
  .leg-col-notes { flex: 2; }
  .leg-hdr {
    background: var(--black);
    color: #fff;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .14em;
    padding: 5px 12px;
    flex-shrink: 0;
  }
  .leg-items { padding: 6px 10px 8px; flex: 1; overflow-y: auto; }
  .leg-empty {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
    font-style: italic;
  }
  .note-row { gap: 4px; margin-bottom: 3px; }
  .note-num {
    font-family: 'Barlow', sans-serif; font-weight: 600; font-size: 12px;
    color: var(--black); min-width: 14px; flex-shrink: 0;
  }
  .note-txt { flex: 1; min-width: 0; white-space: normal; }

  /* Row */
  .leg-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 6px;
    position: relative;
    border-radius: 3px;
    padding: 2px 3px 2px 0;
    transition: background .15s;
  }
  .leg-row:hover .leg-del { opacity: 1; }
  .leg-bdg {
    width: 18px; height: 18px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
    color: #fff;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .leg-diamond {
    width: 10px; height: 10px;
    background: var(--blue);
    transform: rotate(45deg);
    flex-shrink: 0;
    margin: 4px 4px 0;
    cursor: grab;
    user-select: none;
  }
  .leg-diamond:active { cursor: grabbing; }

  .ms-pill {
    width: 18px; height: 18px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
    background: var(--black);
    color: #fff;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 1px;
    cursor: grab;
    user-select: none;
  }
  .ms-pill:active { cursor: grabbing; }
  .ms-pill span {
    pointer-events: auto;
    cursor: text;
    outline: none;
    user-select: text;
  }

  /* Color swatch */
  .color-swatch {
    width: 16px; height: 16px;
    border-radius: 50%;
    flex-shrink: 0;
    cursor: pointer;
    position: relative;
    display: inline-block;
    transition: transform .12s;
    margin-top: 2px;
  }
  .color-swatch:hover { transform: scale(1.2); }
  .drag-handle { cursor: grab; }
  .drag-handle:active { cursor: grabbing; }
  .color-swatch input[type="color"] {
    position: absolute;
    opacity: 0;
    width: 0; height: 0;
    pointer-events: none;
  }

  /* Body: stacked name + sub-row */
  .leg-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .leg-line {
    display: flex;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
  }
  .leg-sub {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  /* Date input */
  .date-inp {
    border: none;
    border-bottom: 1px solid var(--lgray);
    outline: none;
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
    background: transparent;
    padding: 1px 2px;
    cursor: pointer;
    max-width: 110px;
  }
  .date-inp:hover { border-bottom-color: var(--blue); }
  .date-inp:focus { border-bottom-color: var(--blue); color: var(--black); }

  /* Code chip — draggable, color set via inline style */
  .leg-code {
    width: 18px; height: 18px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 11px;
    color: #fff;
    flex-shrink: 0;
    margin-top: 1px;
    cursor: grab;
    user-select: none;
    line-height: 1;
  }
  .leg-code:active { cursor: grabbing; }
  .leg-code span {
    pointer-events: auto;
    cursor: text;
    outline: none;
    user-select: text;
  }

  /* Editable text */
  .leg-field {
    font-family: 'Barlow', sans-serif;
    font-size: 12px;
    color: var(--black);
    outline: none;
    cursor: text;
    border-radius: 2px;
    line-height: 1.4;
  }
  .leg-field:focus {
    background: rgba(32,171,226,.1);
    padding: 0 3px;
  }
  .leg-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .leg-name:focus { overflow: visible; white-space: normal; }
  .leg-date { color: var(--black); flex-shrink: 0; font-size: 11px; white-space: nowrap; }

  /* Delete */
  .leg-del {
    opacity: 0;
    background: none;
    border: none;
    color: var(--black);
    font-size: 11px;
    cursor: pointer;
    padding: 1px 3px;
    flex-shrink: 0;
    transition: opacity .12s, color .12s;
    line-height: 1;
  }
  .leg-del:hover { color: var(--mag); }

  /* Add */
  .leg-add {
    background: none;
    border: none;
    color: var(--blue);
    font-family: 'Barlow', sans-serif;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .07em;
    cursor: grab;
    padding: 4px 0 0;
    opacity: 0.25;
    transition: opacity .15s;
    display: block;
    user-select: none;
  }
  .leg-add:active { cursor: grabbing; }
  .leg-col:hover .leg-add { opacity: 1; }

  .print-only { display: none; }

  /* Read-only (share view): no edit controls, dates shown as text */
  .readonly .leg-del, .readonly .leg-add, .readonly .date-inp { display: none !important; }
  .readonly .print-only { display: inline; }
  .readonly .leg-field { cursor: default; }
  .readonly .leg-name { white-space: normal; overflow: visible; }

  .ms-pill, .leg-code, .leg-diamond { touch-action: none; -webkit-touch-callout: none; }

  /* Touch screens have no hover — keep controls visible and easier to hit */
  @media (hover: none) {
    .leg-del { opacity: .45; padding: 4px 6px; font-size: 12px; }
    .leg-add { opacity: 1; padding: 8px 0 2px; }
    .date-inp { font-size: 16px; max-width: 150px; }
    .ms-pill, .leg-code, .leg-bdg { width: 24px; height: 24px; }
    .leg-diamond { width: 14px; height: 14px; margin: 5px 5px 0; }
    /* Codes fill the whole chip — on touch the chip is for dragging, not editing */
    .ms-pill span, .leg-code span { pointer-events: none; }
  }

  /* Narrow screens: two columns per row, notes full width */
  @media screen and (max-width: 760px) {
    .legend { flex-wrap: wrap; }
    .leg-col { flex: 1 1 50%; border-bottom: 1px solid var(--black); }
    .leg-col:nth-child(2n) { border-right: none; }
    .leg-col-notes { flex-basis: 100%; border-bottom: none; }
    .leg-items { overflow-y: visible; }
  }

  @media print {
    .leg-del, .leg-add { display: none !important; }
    .leg-field { cursor: default; }
    .leg-col  { overflow: visible !important; }
    .leg-items { overflow: visible !important; height: auto !important; }
    .print-only { display: inline !important; }
  }

  .date-print {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
  }
</style>
