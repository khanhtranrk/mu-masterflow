const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exports_ = {};
new Function('exports', ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/dateTime.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports_);
const {parseLocalDateTime,formatLocalDateTime}=exports_;
test('expiration wall-clock date and minute survive local round trips without UTC conversion',()=>{
  for(const value of ['2028-02-29T23:59','2026-12-31T00:00','2027-01-01T08:05']){
    const date=parseLocalDateTime(value);
    assert.ok(date instanceof Date);
    assert.equal(formatLocalDateTime(date),value);
    assert.equal(date.getHours(),Number(value.slice(11,13)));
    assert.equal(date.getMinutes(),Number(value.slice(14,16)));
  }
});
test('invalid calendar dates, time ranges and incomplete text are rejected',()=>{
  for(const value of ['', '2027-02-29T12:00','2026-04-31T12:00','2026-00-20T12:00','2026-10-00T12:00','2026-13-01T12:00','2026-10-31T24:00','2026-10-31T12:60','2026-10-31','2026-10-31T12:00Z'])assert.equal(parseLocalDateTime(value),undefined,value);
});

test('nonexistent daylight-saving times are rejected instead of shifting silently', {skip:process.env.TZ!=='America/New_York'},()=>{
  assert.equal(parseLocalDateTime('2026-03-08T02:30'),undefined);
});
