const {test}=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const out={};
new Function('require','exports',ts.transpileModule(fs.readFileSync('src/artifactPreview.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>id==='@tauri-apps/api/core'?{isTauri:()=>false}:require(id),out);
test('preview chooses supported renderers and treats active HTML/SVG as plain text',()=>{
 for(const [name,mime,kind] of [['cover.png','image/png','image'],['song.mp3','application/octet-stream','audio'],['clip.mp4','video/mp4','video'],['result.json','application/json','text'],['readme.md','text/markdown','text'],['doc.pdf','application/pdf','pdf'],['unsafe.svg','image/svg+xml','text'],['index.html','text/html','text'],['archive.zip','application/zip','unsupported']]) assert.equal(out.artifactPreviewKind(name,mime),kind);
 const raw='<img src=x onerror="alert(1)">';
 const html=renderToStaticMarkup(React.createElement('pre',null,out.previewText(new TextEncoder().encode(raw),'file.html','text/html',false)));
 assert.doesNotMatch(html,/<img/); assert.match(html,/&lt;img/);
 assert.equal(out.previewText(new TextEncoder().encode('{"ok":true}'),'x.json','application/json',false),'{\n  "ok": true\n}');
});
test('browser preview caps streamed bytes, cancels the reader and does not send credentials',async()=>{
 const original=global.fetch;let cancelled=false;
 global.fetch=async(url,options)=>{assert.equal(options.credentials,'omit');return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(out.TEXT_PREVIEW_LIMIT+200));},cancel(){cancelled=true;}}));};
 try {const result=await out.readPreviewBytes('https://storage.example/signed','text',new AbortController().signal);assert.equal(result.bytes.length,out.TEXT_PREVIEW_LIMIT);assert.equal(result.truncated,true);assert.equal(cancelled,true);}finally{global.fetch=original;}
});
