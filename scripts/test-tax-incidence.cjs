const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'energy-tax-incidence-'));
try {
 const root=path.resolve(__dirname,'..');
 execFileSync(process.execPath,[path.join(root,'frontend/node_modules/typescript/bin/tsc'),path.join(root,'frontend/app/backoffice/contracts/tax-incidence.ts'),'--outDir',dir,'--target','es2020','--module','commonjs','--skipLibCheck'],{stdio:'inherit'});
 const {taxTemplate,encodeIncidence,decodeIncidence,incidenceProblem,incidenceText}=require(path.join(dir,'tax-incidence.js'));
 const legacy='Base original com acentos, quebra\nsegunda linha';assert.equal(decodeIncidence(legacy),null);assert.equal(incidenceText(legacy),legacy);
 assert.equal(decodeIncidence('EE_TAX_INCIDENCE_V1\n{"items":null}'),null);
 const model={tax:'PIS',items:taxTemplate('PIS'),notes:legacy};const stored=encodeIncidence(model);assert.deepEqual(decodeIncidence(stored),model);assert.equal(incidenceProblem(stored,'PIS'),null);
 assert.ok(incidenceProblem(stored,'ICMS'));assert.ok(incidenceText(stored).includes('ICMS destacado | Base de incidência: Não | Exclusão: Sim'));
 assert.ok(incidenceProblem(encodeIncidence({tax:'ICMS',items:taxTemplate('ICMS'),notes:''}),'ICMS'));assert.ok(incidenceProblem(encodeIncidence({tax:'IOF',items:taxTemplate('IOF'),notes:''}),'IOF'));
 assert.ok(incidenceProblem(encodeIncidence({tax:'PIS',items:[{component:'X',incidence:'YES',exclusion:'YES',reason:'X'}],notes:''}),'PIS'));
 assert.ok(incidenceProblem(encodeIncidence({tax:'PIS',items:[],notes:''}),'PIS'));assert.ok(incidenceProblem(encodeIncidence({...model,notes:'X'.repeat(4096)}),'PIS'));
 const a=taxTemplate('ICMS');a[0].component='changed';assert.equal(taxTemplate('ICMS')[0].component,'Energia Ativa');
 console.log('Tax incidence: legacy preservation, round-trip, model independence, pending decisions, contradictory choices, tax changes and length checks passed.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
