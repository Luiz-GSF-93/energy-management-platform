// Disposable fixture only. Does not load application credentials or call Azure.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const fixture=fs.readFileSync(path.join(__dirname,'eva-document-parts.cjs'),'utf8');
const marker=' const races=await Promise.allSettled([pc(id(3)';
const at=fixture.indexOf(marker);if(at<0)throw Error('Fixture composition changed');
let source=fixture.slice(0,at)+" await require('./eva-page-curation-legacy-fixture.cjs')({db,id,ok,deny,partSet});await require('./eva-page-curation-extension.cjs')({db,id,ok,deny,jobs});console.log(JSON.stringify({result:'PASS',checks,newPageCurationTables:2,externalCalls:0}));\n }finally{await db.close()}})().catch(e=>{console.error({code:e.code,message:e.message,query:e.internalQuery});process.exitCode=1});\n";
if(process.env.EVA_COMPOSITE_TEST_PG_PORT){
 if(process.env.EVA_COMPOSITE_TEST_PG_PORT!=='55483')throw Error('Only disposable loopback port allowed');
 source=source.replace("const {PGlite}=require('@electric-sql/pglite'),",`const {Pool,types}=require('pg');types.setTypeParser(20,Number);class PGlite{constructor(){this.pool=new Pool({host:'127.0.0.1',port:55483,user:'postgres',database:'postgres',max:4})}exec(sql){return this.pool.query(sql)}query(sql,args){return this.pool.query(sql,args)}close(){return this.pool.end()}};const `);
}
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
