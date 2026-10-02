// Derived from Context Window Meter by Joost Bakker (MIT). See LICENSE and NOTICE.md.
(function () {
  if (window.__chatgpt_history_meter_main_injected) return;
  window.__chatgpt_history_meter_main_injected = true;

  const LOG = '[ChatGPT History Meter]';
  const BUILD = '1.5.0';
  const MAIN_BOOT = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`${LOG} MAIN boot version=${BUILD} boot=${MAIN_BOOT} timeOrigin=${Math.round((typeof performance !== 'undefined' && performance.timeOrigin) || 0)}`);

  // v1.4: keep the console useful. ChatGPT may fetch/replay the same batch
  // payload many times during hydration. We still accept those payloads, but
  // identical conversation states are not re-published or re-logged unless a
  // manual refresh explicitly asks for a UI replay.
  let lastPublishedFingerprint = null;
  let lastLoggedFingerprint = null;
  const observedConversationEndpoints = new Set();

  // Reference values only. They are NOT evidence of the exact prompt budget
  // currently assembled by ChatGPT server-side.
  const MODEL_CONTEXT_LIMITS = {
    'gpt-5-6-thinking': 200000,
    'gpt-5-6-sol': 200000,
    'gpt-5-6': 200000,
    'gpt-5': 200000,
    'o1': 200000,
    'o1-preview': 128000,
    'o1-mini': 128000,
    'o3-mini': 200000,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 16384,
    'default': 128000
  };

  // Keys that commonly hold human-readable payload. Generic object
  // serialization is deliberately avoided: it was the source of a large
  // over-count on tool/search messages in v1.1.
  const TEXT_KEYS = new Set([
    'text', 'content', 'result', 'summary', 'message', 'output', 'stdout',
    'stderr', 'code', 'snippet', 'excerpt', 'quote', 'answer', 'title',
    'caption', 'description', 'query', 'arguments', 'user_instructions',
    'user_profile', 'model_set_context', 'structured_context', 'repo_summary',
    'repository'
  ]);

  // Metadata-like keys are not counted as conversational text. This list is
  // intentionally conservative; nested values under TEXT_KEYS are still read.
  const SKIP_KEYS = new Set([
    'id', 'uuid', 'ref_id', 'asset_id', 'file_id', 'conversation_id',
    'parent_id', 'message_id', 'model_slug', 'resolved_model_slug',
    'default_model_slug', 'author', 'recipient', 'status', 'finish_details',
    'citations', 'metadata', 'attachments', 'image_asset_pointer', 'url',
    'href', 'source_url', 'thumbnail_url'
  ]);

  function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    const length = text.length;
    if (!length) return 0;
    const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
    const punctuation = (text.match(/[^\w\s]/g) || []).length;
    const nonAsciiRatio = nonAscii / length;
    const divisor = nonAsciiRatio > 0.12 ? 2.9 : 3.9;
    const charEstimate = length / divisor;
    const punctuationAdjustment = punctuation * 0.08;
    return Math.max(1, Math.ceil(charEstimate + punctuationAdjustment));
  }

  function getContextLimit(modelSlug) {
    if (!modelSlug) return MODEL_CONTEXT_LIMITS.default;
    const slug = String(modelSlug).toLowerCase();
    const keys = Object.keys(MODEL_CONTEXT_LIMITS)
      .filter(k => k !== 'default')
      .sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (slug.includes(key)) return MODEL_CONTEXT_LIMITS[key];
    }
    return MODEL_CONTEXT_LIMITS.default;
  }

  function looksLikeBinaryOrPointer(value) {
    if (typeof value !== 'string') return false;
    if (value.startsWith('data:') && value.length > 256) return true;
    if (/^[A-Za-z0-9+/=]{2000,}$/.test(value)) return true;
    return false;
  }

  function addUniqueText(parts, seen, value) {
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (!text || looksLikeBinaryOrPointer(text) || seen.has(text)) return;
    seen.add(text);
    parts.push(text);
  }

  function collectTextValue(value, parts, seen, depth, allowGenericObject, parseStructuredStrings = false) {
    if (depth > 8 || value == null) return;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (parseStructuredStrings && trimmed.length > 256 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try {
          const parsed = JSON.parse(trimmed);
          collectTextValue(parsed, parts, seen, depth + 1, true, true);
          return;
        } catch (_) {}
      }
      addUniqueText(parts, seen, value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectTextValue(item, parts, seen, depth + 1, allowGenericObject, parseStructuredStrings);
      }
      return;
    }

    if (typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      if (TEXT_KEYS.has(key)) {
        collectTextValue(child, parts, seen, depth + 1, true, parseStructuredStrings);
      } else if (allowGenericObject && (Array.isArray(child) || (child && typeof child === 'object'))) {
        // Once we are already inside a known text-bearing field, allow nested
        // containers while still refusing arbitrary scalar metadata.
        collectTextValue(child, parts, seen, depth + 1, true, parseStructuredStrings);
      }
    }
  }

  function extractContentText(content, parseStructuredStrings = false) {
    if (!content || typeof content !== 'object') return '';
    const parts = [];
    const seen = new Set();

    // `parts` is a canonical ChatGPT message-text carrier. Strings are counted
    // directly; objects are traversed only through text-bearing keys.
    if (Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (typeof part === 'string') addUniqueText(parts, seen, part);
        else collectTextValue(part, parts, seen, 0, false, parseStructuredStrings);
      }
    }

    // Explicit top-level text-bearing fields.
    for (const key of TEXT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(content, key)) {
        collectTextValue(content[key], parts, seen, 0, true, parseStructuredStrings);
      }
    }

    if (Array.isArray(content.thoughts)) {
      for (const thought of content.thoughts) {
        if (typeof thought === 'string') addUniqueText(parts, seen, thought);
        else collectTextValue(thought, parts, seen, 0, false, parseStructuredStrings);
      }
    }

    return parts.join('\n');
  }

  function getMessageRole(message) {
    const contentType = message?.content?.content_type;
    if (contentType === 'thoughts' || contentType === 'reasoning_recap') return 'thought';
    if (contentType === 'model_editable_context') return 'system';

    const role = message?.author?.role || 'assistant';
    if (role === 'tool') return 'tool';
    if (role === 'system') return 'system';
    if (role === 'user') return 'user';
    return 'assistant';
  }

  function getMessageModelSlug(message) {
    return message?.metadata?.model_slug ||
      message?.metadata?.resolved_model_slug ||
      message?.metadata?.default_model_slug ||
      null;
  }

  function getContentType(message) {
    return String(message?.content?.content_type || 'unknown');
  }

  function estimateRawStructuredChars(content) {
    if (!content || typeof content !== 'object') return 0;
    try {
      return JSON.stringify(content).length;
    } catch (_) {
      return 0;
    }
  }

  function findConversationObject(root) {
    if (!root || typeof root !== 'object') return null;

    const queue = [root];
    const seen = new Set();
    let inspected = 0;

    while (queue.length && inspected < 12000) {
      const obj = queue.shift();
      if (!obj || typeof obj !== 'object' || seen.has(obj)) continue;
      seen.add(obj);
      inspected++;

      if (obj.mapping && typeof obj.mapping === 'object') return obj;

      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (item && typeof item === 'object') queue.push(item);
        }
      } else {
        for (const value of Object.values(obj)) {
          if (value && typeof value === 'object') queue.push(value);
        }
      }
    }

    return null;
  }

  function processConversation(jsonObj, source, options = {}) {
    const conversation = findConversationObject(jsonObj);
    if (!conversation) return false;

    const mapping = conversation.mapping;
    if (!mapping || typeof mapping !== 'object') return false;

    let modelSlug = conversation.default_model_slug || 'unknown';
    const breakdown = { user: 0, assistant: 0, system: 0, tool: 0, thought: 0 };
    const contentTypes = {};
    let totalTokens = 0;
    let messageCount = 0;
    let rawStructuredChars = 0;
    let extractedTextChars = 0;

    const activeNodes = [];
    const visited = new Set();
    let nodeId = conversation.current_node;

    if (nodeId) {
      while (nodeId && !visited.has(nodeId)) {
        const node = mapping[nodeId];
        if (!node) break;
        activeNodes.push(node);
        visited.add(nodeId);
        nodeId = node.parent;
      }
      activeNodes.reverse();
    } else {
      activeNodes.push(...Object.values(mapping));
    }

    for (const node of activeNodes) {
      const msg = node?.message;
      if (!msg) continue;

      const msgModel = getMessageModelSlug(msg);
      if (msgModel) modelSlug = msgModel;

      const role = getMessageRole(msg);
      const contentType = getContentType(msg);
      const text = extractContentText(msg.content, role === 'tool');
      const tokens = estimateTokens(text);

      rawStructuredChars += estimateRawStructuredChars(msg.content);
      extractedTextChars += text.length;
      messageCount++;

      if (!contentTypes[contentType]) {
        contentTypes[contentType] = { messages: 0, tokens: 0, role };
      }
      contentTypes[contentType].messages++;
      contentTypes[contentType].tokens += tokens;

      if (tokens > 0) {
        breakdown[role] += tokens;
        totalTokens += tokens;
      }
    }

    if (!messageCount) return false;

    const limit = getContextLimit(modelSlug);
    const historyToWindowRatio = limit > 0 ? totalTokens / limit : null;

    const toolContentTypes = Object.entries(contentTypes)
      .filter(([, info]) => info.role === 'tool')
      .map(([contentType, info]) => ({ contentType, ...info }))
      .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages)
      .slice(0, 12);

    const fingerprint = [
      String(conversation.current_node || ''),
      String(messageCount),
      String(totalTokens),
      String(modelSlug),
      String(rawStructuredChars),
      String(extractedTextChars),
      String(breakdown.user),
      String(breakdown.assistant),
      String(breakdown.tool),
      String(breakdown.thought),
      String(breakdown.system),
      toolContentTypes.map(x => `${x.contentType}:${x.messages}:${x.tokens}`).join(',')
    ].join('|');

    const stateChanged = fingerprint !== lastPublishedFingerprint;
    const forcePublish = options.forcePublish === true;

    if (stateChanged || forcePublish) {
      window.postMessage({
        type: 'CHATGPT_HISTORY_METER_UPDATE',
        data: {
          historyTokens: totalTokens,
          referenceLimit: limit,
          historyToWindowRatio,
          effectivePromptTokens: null,
          modelSlug,
          breakdown,
          messageCount,
          source,
          approximate: true,
          rawStructuredChars,
          extractedTextChars,
          toolContentTypes,
          updatedAt: new Date().toISOString()
        }
      }, '*');
      lastPublishedFingerprint = fingerprint;
    }

    // Log each distinct history state once. Repeated batch fetches and manual
    // UI replays stay quiet so boot diagnostics remain visible in DevTools.
    if (fingerprint !== lastLoggedFingerprint) {
      lastLoggedFingerprint = fingerprint;
      const heading = `${LOG} History update: ~${totalTokens} text tokens, ${messageCount} messages, model=${modelSlug}`;
      if (typeof console.groupCollapsed === 'function') console.groupCollapsed(heading);
      else console.log(heading);
      console.log(`${LOG} source=${source}`);
      console.log(
        `${LOG} Structured payload: rawChars=${rawStructuredChars}, ` +
        `extractedTextChars=${extractedTextChars}; no conversation text logged.`
      );
      if (toolContentTypes.length && typeof console.table === 'function') {
        console.table(toolContentTypes.map(x => ({
          content_type: x.contentType,
          messages: x.messages,
          estimated_text_tokens: x.tokens
        })));
      }
      if (typeof console.groupEnd === 'function') console.groupEnd();
    }
    return true;
  }

  const originalFetch = window.fetch.bind(window);
  let lastConversationPayload = null;
  let lastConversationSource = null;
  let lastRoute = location.href;

  function postStatus(message, kind = 'info') {
    window.postMessage({
      type: 'CHATGPT_HISTORY_METER_STATUS',
      data: { message, kind, updatedAt: new Date().toISOString() }
    }, '*');
  }

  function rememberAndProcess(json, source) {
    if (!json || typeof json !== 'object') return false;
    const ok = processConversation(json, source);
    if (ok) {
      lastConversationPayload = json;
      lastConversationSource = source;
    }
    return ok;
  }

  function replayLastPayload(reason) {
    if (!lastConversationPayload) {
      postStatus('No conversation payload intercepted yet. Reload this ChatGPT tab to trigger page hydration.', 'waiting');
      return false;
    }
    return processConversation(lastConversationPayload, `${lastConversationSource} · replay:${reason}`, { forcePublish: true });
  }

  function inspectJsonResponse(response, url) {
    try {
      const contentType = response.headers?.get?.('content-type') || '';
      if (!contentType.includes('json')) return;
      response.clone().json().then(json => {
        rememberAndProcess(json, `Intercepted fetch: ${url}`);
      }).catch(() => {});
    } catch (_) {}
  }

  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    try {
      const url = response.url || (typeof args[0] === 'string' ? args[0] : args[0]?.url || '');
      if (/\/backend-api\/conversations?\b/i.test(url)) {
        try {
          const endpoint = new URL(url, location.origin).pathname;
          if (!observedConversationEndpoints.has(endpoint)) {
            observedConversationEndpoints.add(endpoint);
            console.log(`${LOG} Observing conversation endpoint: ${endpoint}`);
          }
        } catch (_) {}
        inspectJsonResponse(response, url);
      }
    } catch (_) {}
    return response;
  };

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const open = OriginalXHR.prototype.open;
    const send = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (method, url, ...rest) {
      this.__cwm_url = String(url || '');
      return open.call(this, method, url, ...rest);
    };

    OriginalXHR.prototype.send = function (...args) {
      if (/\/backend-api\/conversations?\b/i.test(this.__cwm_url || '')) {
        this.addEventListener('load', function () {
          try {
            let json = null;
            if (this.responseType === 'json') json = this.response;
            else if (!this.responseType || this.responseType === 'text') json = JSON.parse(this.responseText);
            if (json) rememberAndProcess(json, `Intercepted XHR: ${this.__cwm_url}`);
          } catch (_) {}
        });
      }
      return send.apply(this, args);
    };
  }

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      setTimeout(() => {
        if (location.href !== lastRoute) {
          lastRoute = location.href;
          lastConversationPayload = null;
          lastConversationSource = null;
          postStatus('Route changed; waiting for ChatGPT conversation hydration.', 'waiting');
        }
      }, 0);
      return result;
    };
  }

  window.addEventListener('popstate', () => {
    lastConversationPayload = null;
    lastConversationSource = null;
    postStatus('Route changed; waiting for ChatGPT conversation hydration.', 'waiting');
  });

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type === 'CHATGPT_HISTORY_METER_FORCE_REFRESH') {
      replayLastPayload('manual');
    }
  });

  postStatus('Waiting for ChatGPT conversation network payload…', 'waiting');
})();
