<script>
  // The Schedule tab: every schedule, in the site's own list style (the editor keeps the schedule maker's look).
  import { projectStore } from '../lib/stores/projects.js';
  import { SCHEDULE_TEMPLATES as TEMPLATES } from '../lib/data/templates.js';
  import { goto } from '../lib/nav.js';
  import { confirmDelete, formModal } from '../../modal';

  let projects = $state([]);
  projectStore.subscribe(v => { projects = v; });


  async function newSchedule() {
    const values = await formModal({
      title: 'New schedule',
      fields: [{ label: 'Start from', value: TEMPLATES[2].label, options: TEMPLATES.map((t) => t.label), single: true, required: true }],
      confirm: 'Make schedule',
    });
    const tpl = values && TEMPLATES.find((t) => t.label === values[0]);
    if (!tpl) return;
    const p = tpl.make();
    projectStore.addProject(p);
    goto(`/project/${p.id}`);
  }

  async function deleteSchedule(id) {
    if (await confirmDelete('schedule')) projectStore.deleteProject(id);
  }

  function fmtDate(str) {
    if (!str) return '';
    const [y, m] = str.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[Number(m)-1]} ${y}`;
  }

  const span = (p) => (p.viewStart ? `${fmtDate(p.viewStart)} – ${fmtDate(p.viewEnd)}` : '');
</script>

<section class="schedule-list">
  <div class="saved">
    <h2 class="label">Schedules</h2>
    {#if projects.length}
      <ol>
        {#each projects as p (p.id)}
          <li>
            <a class="link open" href="#schedule/{encodeURIComponent(p.id)}"><b>{p.title || 'Untitled schedule'}</b> <span>{p.client || ''}</span></a>
            <span class="when">{[span(p), `${p.tasks?.length || 0} tasks`].filter(Boolean).join(' · ')}</span>
            <button class="link" onclick={() => deleteSchedule(p.id)}>Delete</button>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="empty">None yet. Make one here, or from a project page.</p>
    {/if}
    <div class="actions"><button class="btn" onclick={newSchedule}>New schedule</button></div>
  </div>
</section>

<style>
  /* Laid out like the site's other pages (the schedule screens sit outside the site's main area). */
  .schedule-list {
    flex: 1;
    padding: 40px 32px 96px;
    font: 15px/1.5 var(--sans);
    color: var(--ink);
    background: var(--bg);
  }
  .schedule-list .saved { margin-top: 0; max-width: 1100px; }
  .empty { margin: 0; font-size: 14px; }
  @media (max-width: 640px) {
    .schedule-list { padding: 24px 16px 72px; }
  }
</style>
