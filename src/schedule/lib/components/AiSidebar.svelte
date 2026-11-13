<script>
  import { post } from '../../../api';
  // Requests go through our /api/ai endpoint, which holds the API key server-side.
  // Vercel caps request bodies at 4.5 MB and base64 adds ~33%, so files max out at 3 MB.
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
  const MAX_PDF_BYTES   = 3 * 1024 * 1024;

  let { open = false, project = null, onApplyChanges, onClose } = $props();

  let messages    = $state([]);
  let inputVal    = $state('');
  let loading     = $state(false);
  let msgList     = $state(null);
  let fileInputEl = $state(null);
  let attachment  = $state(null);  // { base64, mediaType, name }
  let attachError = $state('');

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    attachError = '';

    const isPdf  = file.type === 'application/pdf';
    const limit  = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;

    if (file.size > limit) {
      attachError = isPdf
        ? 'PDF too large (max 3 MB) — try a screenshot of the key pages instead.'
        : 'Image too large (max 3 MB).';
      return;
    }

    const base64 = await fileToBase64(file);
    attachment = { base64, mediaType: file.type, name: file.name };
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function removeAttachment() {
    attachment  = null;
    attachError = '';
  }

  async function send() {
    const text = inputVal.trim();
    if ((!text && !attachment) || loading) return;

    const history = messages
      .filter(m => m.role === 'user' || m.role === 'bot')
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

    const displayText = text || `[Attached: ${attachment?.name}]`;
    messages = [...messages, { role: 'user', text: displayText, hasAttachment: !!attachment }];
    inputVal = '';

    const snap       = attachment;
    attachment       = null;
    attachError      = '';
    loading          = true;
    scrollToBottom();

    try {
      let userContent;
      if (snap) {
        const fileBlock = snap.mediaType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: snap.base64 } }
          : { type: 'image',    source: { type: 'base64', media_type: snap.mediaType,    data: snap.base64 } };
        userContent = [
          fileBlock,
          { type: 'text', text: text || 'Please analyze this and suggest a project schedule.' },
        ];
      } else {
        userContent = text;
      }

      // This app's endpoint, sent with the access code; throws the server's message on failure.
      const data = await post('/api/schedule-ai', JSON.stringify({
        project,
        messages: [...history, { role: 'user', content: userContent }],
      }), { 'content-type': 'application/json' });

      const raw  = data.text ?? '';

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          // Say plainly when a change didn't take, rather than leave the reply claiming it did.
          const result = parsed.changes?.length && onApplyChanges ? onApplyChanges(parsed.changes) : null;
          const missed = result?.skipped ? ` (${result.skipped} of ${parsed.changes.length} change${parsed.changes.length === 1 ? '' : 's'} couldn't be applied${result.applied ? '' : ', so nothing changed'}.)` : '';
          messages = [...messages, { role: 'bot', text: (parsed.message ?? 'Done.') + missed }];
        } catch {
          messages = [...messages, { role: 'bot', text: raw }];
        }
      } else {
        messages = [...messages, { role: 'bot', text: raw }];
      }
    } catch (err) {
      messages = [...messages, { role: 'bot', text: `Could not reach the API: ${err.message}`, error: true }];
    } finally {
      loading = false;
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    setTimeout(() => { if (msgList) msgList.scrollTop = msgList.scrollHeight; }, 30);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }
</script>

<div class="ai-sidebar" class:open>
  <div class="ai-hdr">
    <span class="ai-title">Schedule Assistant</span>
    <button class="ai-close-btn" onclick={onClose}>✕</button>
  </div>

  <div class="ai-msgs" bind:this={msgList}>
    <div class="ai-bubble ai-hint">
      Try: "Push the 95% submission back 3 weeks" or "Add a 2-week client review in April."
      <br><br>
      You can also attach an image or PDF. For best results, <strong>screenshot the relevant pages</strong> rather than uploading an entire document.
    </div>
    {#each messages as msg}
      <div
        class="ai-bubble"
        class:ai-user={msg.role === 'user'}
        class:ai-bot={msg.role === 'bot'}
        class:ai-error={msg.error}
      >
        {#if msg.hasAttachment}<span class="ai-attach-tag">📎</span>{/if}{msg.text}
      </div>
    {/each}
    {#if loading}
      <div class="ai-bubble ai-bot ai-loading">
        <span></span><span></span><span></span>
      </div>
    {/if}
  </div>

  <div class="ai-foot">
    <input
      bind:this={fileInputEl}
      type="file"
      accept="image/*,application/pdf"
      style="display:none"
      onchange={handleFileSelect}
    />

    {#if attachment}
      <div class="ai-chip">
        <span class="ai-chip-name">📎 {attachment.name}</span>
        <button class="ai-chip-rm" onclick={removeAttachment} title="Remove">✕</button>
      </div>
    {/if}

    {#if attachError}
      <div class="ai-attach-err">{attachError}</div>
    {/if}

    <div class="ai-input-row">
      <textarea
        class="ai-input"
        placeholder="Describe a schedule change…"
        rows="2"
        bind:value={inputVal}
        onkeydown={handleKey}
      ></textarea>
      <div class="ai-btns">
        <button
          class="ai-attach-btn"
          onclick={() => fileInputEl?.click()}
          disabled={loading}
          title="Attach image or PDF (screenshots of key pages work best)"
        >📎</button>
        <button class="ai-send-btn" onclick={send} disabled={loading}>↑</button>
      </div>
    </div>
  </div>
</div>

<style>
  .ai-sidebar {
    position: fixed;
    top: var(--site-header-h, 0px); right: 0; bottom: 0;
    width: 310px;
    background: #fff;
    border-left: 1px solid var(--lgray);
    box-shadow: -6px 0 28px rgba(0,0,0,.1);
    display: flex;
    flex-direction: column;
    z-index: 400;
    transform: translateX(100%);
    transition: transform .22s ease;
    padding-bottom: 56px;
  }
  .ai-sidebar.open { transform: translateX(0); }

  .ai-hdr {
    background: var(--black);
    padding: 14px 18px;
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ai-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: #fff;
  }
  .ai-close-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,.4);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    transition: color .12s;
    padding: 0;
  }
  .ai-close-btn:hover { color: #fff; }

  .ai-msgs {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ai-bubble {
    padding: 10px 13px;
    border-radius: 4px;
    font-family: 'Barlow', sans-serif;
    font-size: 12px;
    line-height: 1.6;
    max-width: 93%;
  }
  .ai-hint  { background: var(--off); color: var(--black); font-style: italic; border-left: 3px solid var(--blue); font-size: 11px; }
  .ai-hint strong { font-style: normal; color: var(--black); }
  .ai-user  { background: var(--blue); color: #fff; align-self: flex-end; }
  .ai-bot   { background: var(--off); color: var(--black); align-self: flex-start; border-left: 3px solid #D4B040; }
  .ai-error { border-left-color: var(--mag); color: var(--mag); }
  .ai-attach-tag { margin-right: 5px; }

  /* Typing indicator */
  .ai-loading { display: flex; align-items: center; gap: 4px; padding: 12px 14px; }
  .ai-loading span {
    width: 6px; height: 6px; border-radius: 50%;
    background: #bbb; animation: bounce .9s infinite;
  }
  .ai-loading span:nth-child(2) { animation-delay: .15s; }
  .ai-loading span:nth-child(3) { animation-delay: .30s; }
  @keyframes bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40%           { transform: translateY(-5px); }
  }

  .ai-foot {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--lgray);
    padding: 8px 10px 10px;
    gap: 6px;
    flex-shrink: 0;
  }

  .ai-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--off);
    border: 1px solid var(--lgray);
    border-radius: 3px;
    padding: 4px 8px;
    gap: 6px;
  }
  .ai-chip-name {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--black);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ai-chip-rm {
    background: none; border: none; cursor: pointer;
    color: var(--black); font-size: 11px; padding: 0; flex-shrink: 0;
    transition: color .1s; line-height: 1;
  }
  .ai-chip-rm:hover { color: var(--mag); }

  .ai-attach-err {
    font-family: 'Barlow', sans-serif;
    font-size: 11px;
    color: var(--mag);
    padding: 0 2px;
  }

  .ai-input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .ai-input {
    flex: 1;
    border: 1px solid var(--lgray);
    border-radius: 3px;
    padding: 7px 11px;
    font-family: 'Barlow', sans-serif;
    font-size: 12px;
    outline: none;
    transition: border-color .12s;
    resize: none;
    line-height: 1.5;
  }
  .ai-input:focus { border-color: var(--blue); }

  .ai-btns {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex-shrink: 0;
  }
  .ai-attach-btn {
    background: #fff;
    color: var(--black);
    border: 1px solid var(--lgray);
    border-radius: 3px;
    padding: 5px 10px;
    font-size: 13px;
    cursor: pointer;
    transition: border-color .12s, color .12s;
    line-height: 1;
  }
  .ai-attach-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); }
  .ai-attach-btn:disabled { opacity: .45; cursor: default; }

  .ai-send-btn {
    background: var(--blue);
    color: #fff;
    border: none;
    border-radius: 3px;
    padding: 8px 14px;
    font-size: 15px;
    cursor: pointer;
    transition: background .12s;
    flex-shrink: 0;
  }
  .ai-send-btn:hover:not(:disabled) { background: #1A93C8; }
  .ai-send-btn:disabled { opacity: .45; cursor: default; }

  .ai-close-btn { padding: 6px; margin: -6px; }

  /* Phones: full-screen panel; 16px inputs stop iOS from zooming on focus */
  @media screen and (max-width: 640px) {
    .ai-sidebar { width: 100%; height: calc(100dvh - var(--site-header-h, 0px)); bottom: auto; border-left: none; }
    .ai-bubble  { font-size: 14px; }
    .ai-hint    { font-size: 13px; }
    .ai-input   { font-size: 16px; }
    .ai-close-btn { font-size: 20px; color: rgba(255,255,255,.7); }
  }

  @media print { .ai-sidebar { display: none !important; } }
</style>
