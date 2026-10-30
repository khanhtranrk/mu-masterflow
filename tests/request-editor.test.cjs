const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
function load(name){const ex={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>id.startsWith('./')?load(id.slice(2)):require(id),ex);return ex;}
const {inputDrafts,draftPayload,payloadIssues,requestTitle}=load('requestModel');
const schema={name:{type:'string'},lyrics:{type:'string'},width:{type:'number',default:1280}};
test('long text, unicode and numeric overrides survive editing without materializing defaults',()=>{
 const lyrics='[Verse 1]\nĐường về sau cơn mưa\n\n[Chorus]\nNgày mai lại sáng';
 const drafts=inputDrafts(schema,{name:'Bài hát',lyrics});
 assert.equal(drafts.width.enabled,false);
 assert.deepEqual(draftPayload(schema,drafts),{name:'Bài hát',lyrics});
 drafts.width={enabled:true,value:'1024'};
 assert.equal(draftPayload(schema,drafts).width,1024);
 assert.deepEqual(payloadIssues(draftPayload(schema,drafts),schema),{});
 assert.equal(requestTitle({name:'Bài hát'},'fallback'),'Bài hát');
});
test('editor exposes invalid numbers, missing inputs and undeclared keys',()=>{
 assert.ok(payloadIssues({name:'x',lyrics:'x',width:'1280'},schema).width);
 assert.ok(payloadIssues({name:'x',lyrics:'x',width:NaN},schema).width);
 assert.ok(payloadIssues({},schema).lyrics);
 assert.ok(payloadIssues(null,schema)._payload);
 assert.ok(payloadIssues({name:'x',lyrics:'x',extra:1},schema).extra);
 const drafts=inputDrafts(schema,{name:'x',lyrics:'y'});drafts.width={enabled:true,value:''};
 assert.ok(payloadIssues(draftPayload(schema,drafts),schema).width);
});
