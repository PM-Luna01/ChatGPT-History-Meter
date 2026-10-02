const fs = require('fs');
const path = require('path');
const assert = require('assert');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
assert.match(css, /\.cwm-card\s*\{[\s\S]*?max-height:\s*calc\(100dvh\s*-\s*6rem\)/, 'card must be viewport bounded');
assert.match(css, /\.cwm-card\s*\{[\s\S]*?overflow-y:\s*auto/, 'card must scroll internally');
assert.match(css, /\.cwm-card-head\s*\{[\s\S]*?position:\s*sticky/, 'card header must stay visible');
console.log('layout regression: PASS');
