// Run the existing legacy transport/publication fixture AFTER the new migration,
// retaining its original assertions and without editing the legacy fixture.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const name=path.join(__dirname,'eva-composite-publication-extension.cjs');
let source=fs.readFileSync(name,'utf8');
const marker=' const rpc=(actor,action,key,body)=>';
if(source.split(marker).length!==2)throw Error('Review legacy fixture composition');
source=source.replace(marker," const beforePageMigration=(await db.query('SELECT count(*) n FROM eva_official_extraction_versions')).rows[0].n;await db.exec(fs.readFileSync(root+'/20261108_eva_page_curation.sql','utf8'));assert.equal((await db.query('SELECT count(*) n FROM eva_official_extraction_versions')).rows[0].n,beforePageMigration);ok(true);\n"+marker);
const mod=new Module(name,module);mod.filename=name;mod.paths=module.paths;mod._compile(source,name);module.exports=mod.exports;
