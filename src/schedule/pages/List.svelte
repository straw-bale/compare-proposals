<script>
  import { projectStore } from '../lib/stores/projects.js';
  import { createBlankProject, createSmallTemplate, createMediumTemplate, createLargeTemplate } from '../lib/data/sample.js';
  import { goto } from '../lib/nav.js';
  import { confirmDelete } from '../../modal';

  let projects = $state([]);
  projectStore.subscribe(v => { projects = v; });

  let templateModal = $state(false);

  // Preview bar definitions for each template card.
  // Each bar: { l: left%, w: width%, c: color } — one bar per task row.
  const TEMPLATES = [
    {
      key:  'blank',
      type: 'Blank',
      name: 'Empty Project',
      desc: 'Start from scratch. No tasks, no dates — just an empty timeline ready for your input.',
      meta: '1 task · Custom duration',
      bars: [],
    },
    {
      key:  'small',
      type: 'Small',
      name: 'Renovation / TI',
      desc: 'SD through construction for smaller scopes. Standard client review, single CD submission.',
      meta: '~12 months · 14 tasks',
      bars: [
        { l:0,  w:7,  c:'#9E9068' },  // Programming
        { l:7,  w:13, c:'#00914D' },  // SD
        { l:20, w:13, c:'#6B7A2A' },  // DD
        { l:33, w:7,  c:'#949494' },  // DD Review
        { l:40, w:13, c:'#3D5018' },  // CDs
        { l:53, w:7,  c:'#949494' },  // CD Review
        { l:60, w:9,  c:'#282829' },  // Bidding
        { l:69, w:24, c:'#3B8FA0' },  // Construction
        { l:93, w:7,  c:'#282829' },  // Closeout
      ],
    },
    {
      key:  'medium',
      type: 'Medium',
      name: 'Commercial / Institutional',
      desc: 'Full AE phase sequence — SD, 50%, 95%, 100%, CDs — with client review cycles at each milestone.',
      meta: '~23 months · 17 tasks',
      bars: [
        { l:0,  w:5,  c:'#9E9068' },  // Programming
        { l:5,  w:9,  c:'#00914D' },  // SD
        { l:14, w:5,  c:'#949494' },  // SD Review
        { l:19, w:11, c:'#00914D' },  // 50% DD
        { l:30, w:5,  c:'#949494' },  // 50% Review
        { l:35, w:9,  c:'#6B7A2A' },  // 95% CDs
        { l:44, w:5,  c:'#949494' },  // 95% Review
        { l:49, w:7,  c:'#3D5018' },  // 100% CDs
        { l:56, w:5,  c:'#282829' },  // Final CDs
        { l:61, w:5,  c:'#282829' },  // Bidding
        { l:66, w:27, c:'#3B8FA0' },  // Construction
        { l:93, w:7,  c:'#282829' },  // Closeout
      ],
    },
    {
      key:  'large',
      type: 'Large',
      name: 'Large / Complex',
      desc: 'Extended owner review cycles at each submission, permitting phase, and major construction period.',
      meta: '~36 months · 21 tasks',
      bars: [
        { l:0,  w:4,  c:'#9E9068' },  // Programming
        { l:4,  w:7,  c:'#00914D' },  // SD
        { l:11, w:4,  c:'#949494' },  // SD Review
        { l:15, w:8,  c:'#00914D' },  // 50% DD
        { l:23, w:4,  c:'#949494' },  // 50% Review
        { l:27, w:7,  c:'#6B7A2A' },  // 95% CDs
        { l:34, w:4,  c:'#949494' },  // 95% Review
        { l:38, w:5,  c:'#3D5018' },  // 100% CDs
        { l:43, w:4,  c:'#949494' },  // 100% Review
        { l:47, w:4,  c:'#282829' },  // Final CDs
        { l:51, w:7,  c:'#D83968' },  // Permit
        { l:58, w:35, c:'#3B8FA0' },  // Construction
        { l:93, w:5,  c:'#282829' },  // Closeout
      ],
    },
  ];

  function openProject(id) { goto(`/project/${id}`); }

  function createProject(key) {
    const fn = { blank: createBlankProject, small: createSmallTemplate, medium: createMediumTemplate, large: createLargeTemplate }[key];
    const p = fn();
    projectStore.addProject(p);
    goto(`/project/${p.id}`);
  }

  async function deleteProject(e, id) {
    e.stopPropagation();
    if (projects.length <= 1) return;
    if (await confirmDelete('schedule')) projectStore.deleteProject(id);
  }

  function fmtDate(str) {
    if (!str) return '';
    const [y, m] = str.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[Number(m)-1]} ${y}`;
  }
</script>

<div class="home">
  <main class="home-main">
    <div class="top-bar">
      <h2 class="section-hdr">Projects</h2>
      <div class="top-actions">
        <button class="btn-secondary" onclick={() => goto('/system-prompt')}>System Prompt</button>
        <button class="btn-primary" onclick={() => templateModal = true}>+ New Project</button>
      </div>
    </div>

    <div class="project-grid">
      {#each projects as project (project.id)}
        <div class="project-card" onclick={() => openProject(project.id)} role="button" tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && openProject(project.id)}>

          <div class="card-accent" style:background="var(--blue)"></div>
          <div class="card-body">
            <div class="card-title">{project.title || 'Untitled Project'}</div>
            {#if project.client}
              <div class="card-client">{project.client}</div>
            {/if}
            {#if project.number}
              <div class="card-num">{project.number}</div>
            {/if}
            <div class="card-meta">
              {#if project.viewStart}
                <span class="card-dates">{fmtDate(project.viewStart)} – {fmtDate(project.viewEnd)}</span>
              {/if}
              <span class="card-tasks">{project.tasks?.length || 0} tasks</span>
            </div>
          </div>
          {#if projects.length > 1}
            <button class="card-delete" title="Delete project" onclick={(e) => deleteProject(e, project.id)}>✕</button>
          {/if}
        </div>
      {/each}

      {#if projects.length === 0}
        <div class="empty-state">
          <p>No projects yet.</p>
          <button class="btn-primary" onclick={() => templateModal = true}>Create your first project</button>
        </div>
      {/if}
    </div>
  </main>

</div>

<!-- Template picker modal -->
{#if templateModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tm-overlay" onclick={() => templateModal = false}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tm-panel" onclick={(e) => e.stopPropagation()}>

      <div class="tm-hdr">
        <span class="tm-hdr-title">New Project</span>
        <button class="tm-x" onclick={() => templateModal = false}>✕</button>
      </div>

      <div class="tm-body">
        <div class="tm-cards">
          {#each TEMPLATES as tpl}
            <button class="tm-card" onclick={() => createProject(tpl.key)}>
              <div class="tm-type">{tpl.type}</div>

              <!-- Mini Gantt preview -->
              <div class="tm-preview" style:height="{tpl.bars.length > 0 ? tpl.bars.length * 7 + 4 : 52}px">
                {#if tpl.bars.length === 0}
                  <div class="tm-blank-lines">
                    <div class="tm-blank-line" style:width="40%"></div>
                    <div class="tm-blank-line" style:width="65%"></div>
                    <div class="tm-blank-line" style:width="55%"></div>
                  </div>
                {:else}
                  {#each tpl.bars as bar, i}
                    <div
                      class="tm-bar"
                      style:left="{bar.l}%"
                      style:width="{bar.w}%"
                      style:top="{i * 7}px"
                      style:background={bar.c}
                    ></div>
                  {/each}
                {/if}
              </div>

              <div class="tm-info">
                <div class="tm-name">{tpl.name}</div>
                <div class="tm-desc">{tpl.desc}</div>
                <div class="tm-meta">{tpl.meta}</div>
              </div>
            </button>
          {/each}
        </div>
      </div>

    </div>
  </div>
{/if}

<style>
  .home {
    flex: 1; /* fills the space between the site header and footer */
    display: flex;
    flex-direction: column;
    background: var(--off);
    font-family: 'Barlow', sans-serif;
  }

  /* Main */
  .home-main {
    flex: 1;
    padding: 40px 40px 60px;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
  }
  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .section-hdr {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: .14em;
    color: var(--black);
    margin: 0;
  }
  .top-actions { display: flex; gap: 10px; }
  .btn-primary {
    background: var(--blue);
    color: #fff;
    border: none;
    border-radius: 3px;
    padding: 9px 18px;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .08em;
    cursor: pointer;
    transition: background .12s;
  }
  .btn-primary:hover { background: #1A93C8; }
  .btn-secondary {
    background: none;
    color: var(--black);
    border: 1px solid var(--lgray);
    border-radius: 3px;
    padding: 9px 18px;
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .08em;
    cursor: pointer;
    transition: border-color .12s, color .12s;
  }
  .btn-secondary:hover { border-color: var(--blue); color: var(--blue); }

  /* Grid */
  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
    gap: 16px;
  }
  .project-card {
    background: #fff;
    border: 1px solid var(--lgray);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    display: flex;
    flex-direction: column;
    transition: box-shadow .15s, transform .12s;
    outline: none;
  }
  .project-card:hover { box-shadow: 0 6px 22px rgba(0,0,0,.1); transform: translateY(-2px); }
  .project-card:focus-visible { box-shadow: 0 0 0 2px var(--blue); }
  .card-accent { height: 4px; flex-shrink: 0; }
  .card-body { padding: 18px 20px 16px; flex: 1; }
  .card-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--black);
    margin-bottom: 4px;
  }
  .card-client {
    font-size: 11px;
    color: var(--black);
    margin-bottom: 2px;
  }
  .card-num {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
    text-transform: uppercase;
    letter-spacing: .06em;
    margin-bottom: 12px;
  }
  .card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    border-top: 1px solid var(--lgray);
    padding-top: 10px;
  }
  .card-dates {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
  }
  .card-tasks {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--black);
  }
  .card-delete {
    position: absolute;
    top: 10px; right: 10px;
    background: none;
    border: none;
    color: var(--black);
    font-size: 13px;
    cursor: pointer;
    opacity: 0;
    transition: opacity .12s, color .12s;
    padding: 3px 5px;
  }
  .project-card:hover .card-delete { opacity: 1; }
  .card-delete:hover { color: var(--mag); }

  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 80px 0;
    color: var(--black);
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  /* ── Template picker modal ────────────────────────────────────── */
  .tm-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.52);
    display: flex; align-items: center; justify-content: center;
    z-index: 800;
  }
  .tm-panel {
    background: #fff;
    border-radius: 4px;
    width: min(980px, 94vw);
    max-height: 90vh;
    overflow: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,.3);
  }
  .tm-hdr {
    background: var(--black);
    padding: 14px 20px;
    display: flex; align-items: center; justify-content: space-between;
    border-radius: 4px 4px 0 0;
    position: sticky; top: 0;
  }
  .tm-hdr-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700; font-size: 15px;
    text-transform: uppercase; letter-spacing: .06em;
    color: #fff;
  }
  .tm-x {
    background: none; border: none;
    color: rgba(255,255,255,.4); font-size: 17px; line-height: 1;
    cursor: pointer; transition: color .12s; padding: 0;
  }
  .tm-x:hover { color: #fff; }

  .tm-body { padding: 20px; }
  .tm-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }

  .tm-card {
    background: none;
    border: 1.5px solid var(--lgray);
    border-radius: 4px;
    padding: 16px 14px 14px;
    cursor: pointer; text-align: left;
    display: flex; flex-direction: column;
    transition: border-color .15s, transform .12s, box-shadow .15s;
  }
  .tm-card:hover {
    border-color: var(--blue);
    transform: translateY(-2px);
    box-shadow: 0 6px 22px rgba(0,0,0,.1);
  }

  /* Type label */
  .tm-type {
    font-family: 'Barlow', sans-serif;
    font-weight: 700; font-size: 11px;
    text-transform: uppercase; letter-spacing: .16em;
    color: var(--black); margin-bottom: 10px;
    transition: color .15s;
  }
  .tm-card:hover .tm-type { color: var(--blue); }

  /* Mini gantt preview */
  .tm-preview {
    position: relative; width: 100%;
    background: rgba(0,0,0,.04);
    border-radius: 2px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .tm-bar {
    position: absolute; height: 4px; border-radius: 2px;
  }
  .tm-blank-lines {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    justify-content: center; gap: 7px;
    padding: 10px 12px;
  }
  .tm-blank-line {
    height: 4px; border-radius: 2px;
    background: rgba(0,0,0,.1);
  }

  /* Card info */
  .tm-info { display: flex; flex-direction: column; flex: 1; }
  .tm-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700; font-size: 14px;
    color: var(--black); margin-bottom: 5px;
  }
  .tm-desc {
    font-family: 'Barlow', sans-serif;
    font-size: 11px; color: var(--black); line-height: 1.55;
    flex: 1; margin-bottom: 10px;
  }
  @media (hover: none) {
    .card-delete { opacity: .5; padding: 8px 10px; top: 4px; right: 4px; }
    .project-card:hover { transform: none; box-shadow: none; }
  }

  @media screen and (max-width: 860px) {
    .tm-cards { grid-template-columns: repeat(2, 1fr); }
  }

  @media screen and (max-width: 640px) {
    .home-main { padding: 20px 16px 72px; }
    .top-bar   { flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
    .top-actions { width: 100%; }
    .top-actions button { flex: 1; padding: 11px 10px; }

    .tm-overlay { align-items: flex-end; }
    .tm-panel   { width: 100%; max-height: 92dvh; border-radius: 8px 8px 0 0; }
    .tm-hdr     { border-radius: 8px 8px 0 0; }
    .tm-x       { padding: 6px; margin: -6px; font-size: 20px; }
    .tm-body    { padding: 14px; }
    .tm-cards   { grid-template-columns: 1fr; gap: 10px; }
  }

  .tm-meta {
    font-family: 'Barlow', sans-serif;
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--black);
    border-top: 1px solid var(--lgray); padding-top: 8px;
  }
</style>
