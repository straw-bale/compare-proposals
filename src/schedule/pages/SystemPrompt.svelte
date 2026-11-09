<script>

  let { data } = $props();

  // Minimal markdown → HTML: headers, bold, italic, hr, lists, code blocks
  function renderMarkdown(md) {
    let html = md
      // Code blocks
      .replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, -3).replace(/^\w+\n/, '')}</code></pre>`)
      // HR
      .replace(/^---$/gm, '<hr>')
      // H1–H3
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold + italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // List items
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // Numbered list items
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Paragraphs: blank-line-separated blocks not already tagged
      .split(/\n{2,}/)
      .map(block => {
        block = block.trim();
        if (!block) return '';
        if (/^<(h[123]|hr|pre|ul|ol|li)/.test(block)) return block;
        // Wrap consecutive <li> in <ul>
        if (block.includes('<li>')) return `<ul>${block}</ul>`;
        return `<p>${block.replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');

    return html;
  }
</script>

<div class="sp-page">
  <main class="sp-main">
    <a class="btn-back" href="#schedule">← Schedules</a>
    <div class="sp-card">
      <div class="sp-body">
        {@html renderMarkdown(data.markdown)}
      </div>
      <div class="sp-foot">
        <p>To customise: edit <code>lib/schedule-prompt.ts</code> in the project repository.</p>
      </div>
    </div>
  </main>
</div>

<style>
  .sp-page {
    flex: 1; /* fills the space between the site header and footer */
    display: flex;
    flex-direction: column;
    background: var(--off);
    font-family: 'Barlow', sans-serif;
  }

  .btn-back {
    display: inline-block;
    margin-bottom: 16px;
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--black);
    text-decoration: none;
    transition: color .12s;
  }
  .btn-back:hover { border-color: var(--blue); color: var(--blue); }

  /* Main */
  .sp-main {
    flex: 1;
    padding: 40px;
    max-width: 800px;
    width: 100%;
    margin: 0 auto;
  }

  .sp-card {
    background: #fff;
    border: 1px solid var(--lgray);
    border-radius: 4px;
    overflow: hidden;
  }

  .sp-body {
    padding: 40px 48px;
  }

  /* Markdown styles */
  .sp-body :global(h1) {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 22px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--black);
    margin: 0 0 20px;
  }
  .sp-body :global(h2) {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--black);
    margin: 28px 0 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--lgray);
  }
  .sp-body :global(h3) {
    font-family: 'Barlow', sans-serif;
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--black);
    margin: 18px 0 6px;
  }
  .sp-body :global(p) {
    font-size: 13.5px;
    color: var(--black);
    line-height: 1.7;
    margin: 0 0 12px;
  }
  .sp-body :global(hr) {
    border: none;
    border-top: 1px solid var(--lgray);
    margin: 24px 0;
  }
  .sp-body :global(ul) {
    margin: 0 0 14px;
    padding-left: 20px;
  }
  .sp-body :global(li) {
    font-size: 13px;
    color: var(--black);
    line-height: 1.65;
    margin-bottom: 4px;
  }
  .sp-body :global(strong) { color: var(--black); font-weight: 700; }
  .sp-body :global(em) { font-style: italic; color: var(--black); }
  .sp-body :global(code) {
    font-family: 'Courier New', monospace;
    font-size: 11.5px;
    background: rgba(0,0,0,.06);
    border-radius: 2px;
    padding: 1px 5px;
    color: var(--black);
  }
  .sp-body :global(pre) {
    background: var(--black);
    border-radius: 4px;
    padding: 16px 20px;
    overflow-x: auto;
    margin: 16px 0;
  }
  .sp-body :global(pre code) {
    background: none;
    padding: 0;
    color: rgba(255,255,255,.85);
    font-size: 12px;
  }

  .sp-foot {
    border-top: 1px solid var(--lgray);
    padding: 14px 48px;
    background: var(--off);
  }
  .sp-foot p {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
    margin: 0;
  }
  .sp-foot code {
    font-size: 11px;
    background: rgba(0,0,0,.06);
    border-radius: 2px;
    padding: 1px 5px;
    color: var(--black);
  }
</style>
