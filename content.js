// Derived from Context Window Meter by Joost Bakker (MIT). See LICENSE and NOTICE.md.
(function () {
  if (globalThis.__chatgpt_history_meter_content_v150) return;
  globalThis.__chatgpt_history_meter_content_v150 = true;

  const EXTENSION_ID = chrome.runtime?.id || 'unknown';
  const EXTENSION_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
  const EXT_SHORT = EXTENSION_ID.slice(0, 8);
  const BOOT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const BOOT_AT = new Date().toISOString();
  console.log(`[ChatGPT History Meter] ISOLATED boot version=${EXTENSION_VERSION} extension=${EXTENSION_ID} boot=${BOOT_ID} at=${BOOT_AT}`);
  let widget = null;
  let card = null;
  let current = null;
  let statusMessage = 'Reading conversation history…';
  let isOpen = false;

  const CATEGORIES = [
    ['user', 'Your messages'],
    ['assistant', 'ChatGPT replies'],
    ['tool', 'Tool / search text'],
    ['thought', 'Reasoning recap'],
    ['system', 'System / context in history']
  ];

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return new Intl.NumberFormat().format(Math.round(n || 0));
  }

  function compact(n) {
    if (!n) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  function ratioText(ratio) {
    if (!Number.isFinite(ratio)) return 'unknown';
    if (ratio < 1) return `${Math.round(ratio * 100)}% of reference window`;
    return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}× reference window`;
  }

  function create() {
    if (widget || !document.body) return;

    widget = document.createElement('button');
    widget.id = `chatgpt-history-meter-badge-${EXT_SHORT}`;
    widget.dataset.cwmExtensionId = EXTENSION_ID;
    widget.dataset.cwmBootId = BOOT_ID;
    widget.className = 'cwm-badge cwm-loading';
    widget.type = 'button';
    widget.innerHTML = `
      <span class="cwm-ring"><span class="cwm-pct">…</span></span>
      <span class="cwm-labels"><small>History</small><strong class="cwm-count">Reading…</strong></span>
    `;

    card = document.createElement('div');
    card.id = `chatgpt-history-meter-details-${EXT_SHORT}`;
    card.dataset.cwmExtensionId = EXTENSION_ID;
    card.dataset.cwmBootId = BOOT_ID;
    card.className = 'cwm-card cwm-hidden';

    widget.addEventListener('click', e => {
      e.stopPropagation();
      window.postMessage({ type: 'CHATGPT_HISTORY_METER_FORCE_REFRESH' }, '*');
      isOpen = !isOpen;
      renderCard();
    });

    document.addEventListener('click', e => {
      if (isOpen && card && !card.contains(e.target) && !widget.contains(e.target)) {
        isOpen = false;
        card.classList.add('cwm-hidden');
      }
    });

    const otherInstances = Array.from(document.querySelectorAll('[data-cwm-extension-id]'))
      .map(el => el.dataset.cwmExtensionId)
      .filter(id => id && id !== EXTENSION_ID);
    if (otherInstances.length) {
      console.warn(`[ChatGPT History Meter] DUPLICATE INSTALL DETECTED: current=${EXTENSION_ID}; other=${[...new Set(otherInstances)].join(',')}`);
    }

    document.body.append(widget, card);
    renderCard();
  }

  function update(data) {
    create();
    current = data;
    widget.classList.remove('cwm-loading');

    const pct = widget.querySelector('.cwm-pct');
    const count = widget.querySelector('.cwm-count');
    const ratio = data.historyToWindowRatio;

    // The ring is now only a qualitative history/reference comparison. It is
    // not labelled as prompt usage and never implies authoritative fullness.
    const visualPct = Number.isFinite(ratio) ? Math.min(100, ratio * 100) : 0;
    if (pct) pct.textContent = Number.isFinite(ratio) ? (ratio >= 10 ? '10×+' : `${ratio.toFixed(ratio < 1 ? 2 : 1)}×`) : '?';
    if (count) count.textContent = `≈${fmt(data.historyTokens)} tokens`;

    widget.style.setProperty('--cwm-pct', `${visualPct}%`);
    widget.title = `Estimated active-branch conversation history: ~${fmt(data.historyTokens)} text tokens. Effective prompt usage is unknown.`;
    renderCard();
  }

  function setStatus(message) {
    statusMessage = message || 'Waiting for conversation data…';
    if (!current) {
      create();
      const count = widget?.querySelector('.cwm-count');
      if (count) count.textContent = statusMessage.includes('HTTP') ? 'Fetch error' : 'Waiting…';
      renderCard();
    }
  }

  function renderCard() {
    if (!card) return;
    if (!isOpen) {
      card.classList.add('cwm-hidden');
      return;
    }
    card.classList.remove('cwm-hidden');

    if (!current) {
      card.innerHTML = `
        <div class="cwm-card-head"><strong>Conversation history</strong><span>v${esc(EXTENSION_VERSION)}</span></div>
        <p class="cwm-muted">Extension ${esc(EXT_SHORT)} · boot ${esc(BOOT_ID)}</p>
        <p>${esc(statusMessage)}</p>
        <p class="cwm-muted">Click the badge to replay the latest intercepted conversation payload.</p>
      `;
      return;
    }

    const rows = CATEGORIES.map(([key, label]) => {
      const n = current.breakdown?.[key] || 0;
      const share = current.historyTokens ? Math.round((n / current.historyTokens) * 100) : 0;
      return `<div class="cwm-row"><span>${esc(label)}</span><b>${fmt(n)}</b><em>${share}%</em></div>`;
    }).join('');

    const toolTypes = (current.toolContentTypes || []).slice(0, 6).map(item =>
      `<div class="cwm-row cwm-row-small"><span>${esc(item.contentType)}</span><b>${fmt(item.tokens)}</b><em>${fmt(item.messages)} msg</em></div>`
    ).join('');

    const reduction = current.rawStructuredChars > 0
      ? Math.max(0, 1 - (current.extractedTextChars / current.rawStructuredChars))
      : 0;

    card.innerHTML = `
      <div class="cwm-card-head"><strong>Conversation history</strong><span>${esc(current.modelSlug || 'unknown')}</span></div>
      <p class="cwm-muted">Extension ${esc(EXT_SHORT)} · v${esc(EXTENSION_VERSION)} · boot ${esc(BOOT_ID)}</p>
      <div class="cwm-big">≈${fmt(current.historyTokens)} <small>text tokens</small></div>
      <p>Configured model window reference: ${fmt(current.referenceLimit)} tokens</p>
      <p>History/reference ratio: <b>${esc(ratioText(current.historyToWindowRatio))}</b></p>
      <p class="cwm-effective">Effective prompt usage: <b>Unknown</b></p>
      <div class="cwm-divider"></div>
      ${rows}
      ${toolTypes ? `<div class="cwm-divider"></div><p class="cwm-muted">Largest tool content types (text only)</p>${toolTypes}` : ''}
      <div class="cwm-divider"></div>
      <p class="cwm-muted">${esc(current.messageCount || 0)} active-branch messages</p>
      <p class="cwm-muted">Source: ${esc(current.source)}</p>
      <p class="cwm-muted">Structured payload filter removed ≈${Math.round(reduction * 100)}% of raw content-object characters before text estimation.</p>
      <p class="cwm-warning">History size is not the prompt ChatGPT necessarily sends to the model. Server-side compaction, summaries, retrieval and hidden context assembly are not observable here.</p>
    `;
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type === 'CHATGPT_HISTORY_METER_UPDATE') update(event.data.data);
    if (event.data?.type === 'CHATGPT_HISTORY_METER_STATUS') setStatus(event.data.data?.message);
  });

  function init() {
    create();
    window.postMessage({ type: 'CHATGPT_HISTORY_METER_FORCE_REFRESH' }, '*');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
