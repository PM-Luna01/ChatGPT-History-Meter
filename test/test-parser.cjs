const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'page_script.js'), 'utf8');

const duplicateText = 'search result excerpt '.repeat(150);
const hugeMetadata = 'X'.repeat(500000);
const conversation = {
  current_node: 'tool',
  default_model_slug: 'gpt-5-6-thinking',
  mapping: {
    root: { parent: null, message: null },
    user: {
      parent: 'root',
      message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello world'] } }
    },
    assistant: {
      parent: 'user',
      message: { author: { role: 'assistant' }, metadata: { model_slug: 'gpt-5-6-thinking' }, content: { content_type: 'text', parts: ['reply text'] } }
    },
    tool: {
      parent: 'assistant',
      message: {
        author: { role: 'tool' },
        content: {
          content_type: 'tool_result',
          parts: [{ text: duplicateText, metadata: hugeMetadata, id: 'abc' }],
          result: { text: duplicateText, metadata: hugeMetadata, id: 'abc' },
          metadata: hugeMetadata
        }
      }
    }
  }
};

const updates = [];
const logs = [];
const fakeWindow = {
  __cwm_edge_patch_injected: false,
  fetch: async (url) => new Response(JSON.stringify({ payload: { conversations: [conversation] } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }),
  postMessage(msg) { if (msg.type === 'CHATGPT_HISTORY_METER_UPDATE') updates.push(msg.data); },
  addEventListener() {},
  XMLHttpRequest: null,
};
fakeWindow.window = fakeWindow;

const ctx = {
  window: fakeWindow,
  Response,
  URL,
  location: { href: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc', pathname: '/c/12345678-1234-1234-1234-123456789abc', search: '' },
  history: { pushState(){}, replaceState(){} },
  setTimeout() { return 1; },
  clearTimeout() {},
  console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), table() {} },
  Date,
  Set,
  Map,
  Object,
  Array,
  String,
  Number,
  Math,
  JSON,
  RegExp,
};
vm.runInNewContext(source, ctx, { filename: 'page_script.js' });

(async () => {
  await fakeWindow.fetch('https://chatgpt.com/backend-api/conversations/batch');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(updates.length, 1, 'expected exactly one history update after first payload');
  await fakeWindow.fetch('https://chatgpt.com/backend-api/conversations/batch');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(updates.length, 1, 'identical repeated payload should be deduplicated');
  const d = updates.at(-1);
  assert.equal(d.messageCount, 3);
  assert.equal(d.modelSlug, 'gpt-5-6-thinking');
  assert.ok(d.breakdown.tool > 0, 'tool text should be counted');
  assert.ok(d.breakdown.tool < 5000, `tool overcounted: ${d.breakdown.tool}`);
  assert.ok(d.rawStructuredChars > 500000, 'raw structured diagnostic should see metadata size');
  assert.ok(d.extractedTextChars < 10000, 'filtered text should stay compact');
  assert.equal(d.toolContentTypes[0].contentType, 'tool_result');
  assert.equal(d.effectivePromptTokens, null);
  console.log(JSON.stringify({
    messageCount: d.messageCount,
    historyTokens: d.historyTokens,
    toolTokens: d.breakdown.tool,
    rawStructuredChars: d.rawStructuredChars,
    extractedTextChars: d.extractedTextChars,
    ratio: d.historyToWindowRatio
  }, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
