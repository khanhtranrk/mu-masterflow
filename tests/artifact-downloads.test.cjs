const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const out={};
new Function('exports',ts.transpileModule(fs.readFileSync('src/artifactDownloads.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out);
test('legacy download uses the selected Convex API while signed S3 URLs stay unchanged',()=>{
 const legacy={legacy:true,url:'https://retired.example/api/storage/file-id'};
 assert.equal(out.artifactDownloadUrl(legacy,'http://127.0.0.1:3210'),'http://127.0.0.1:3210/api/storage/file-id');
 const signed={legacy:false,url:'https://bucket.example/file?X-Amz-Signature=abc%2Fdef&z=1'};
 assert.equal(out.artifactDownloadUrl(signed,'http://127.0.0.1:3210'),signed.url);
 assert.throws(()=>out.artifactDownloadUrl({legacy:false,url:'file:///etc/passwd'},'http://127.0.0.1:3210'),/invalid download URL/);
});
