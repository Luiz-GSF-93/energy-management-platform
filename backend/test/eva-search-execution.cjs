// Run the shared disposable PostgreSQL fixture, then add execution scenarios.
// Only checked-in test code is composed; no credentials or provider are loaded.
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
const fixture=fs.readFileSync(path.join(__dirname,'eva-search-preparation.cjs'),'utf8');
const marker="console.log(JSON.stringify({result:'PASS',checks,tables:5,externalCalls:0}));";
if(!fixture.includes(marker))throw Error('Preparation fixture changed; review test composition.');
const extension="await require('./eva-search-execution-extension.cjs')({db,id,ok,deny,call,body,orderJob,orderVersion,orderReview,orderChunks,manifest,checks});console.log(JSON.stringify({result:'PASS',checks,tables:8,externalCalls:0}));";
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(fixture.replace(marker,extension),__filename);
