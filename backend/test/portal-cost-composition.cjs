// Disposable database only. Regression for the private projection of published monthly costs.
const fs=require('node:fs'),path=require('node:path');
module.exports=async(db,ok)=>{
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261211_portal_published_cost_composition.sql'),'utf8'));
 await db.exec('BEGIN');
 try{
  const id='90000000-0000-4000-8000-000000000099',hash='c'.repeat(64),cost=(id,category,source,scenario='ACL')=>({id,category,source,scenario,label:'Published cost',amount:'5.00',effect:'COST'});
  const items=[cost('ccee','CCEE','CCEE source'),cost('cip','OTHER','Invoice doc-test'),cost('supplier','SUPPLIER_INVOICE','Supplier NF'),cost('consumed','OTHER','Contract source'),cost('acr','CCEE','Other source','ACR')];
  const report={units:[{id:'unit',documentId:'doc-test',sources:{contractDraft:{consumedCostSources:[{id:'consumed'}]}},fields:[{key:'costs:monthly',state:'FILLED',value:{items}},{key:'costs:monthly',state:'PENDING',value:{items:[cost('pending','CCEE','Unconfirmed')]}}]}]};
  await db.query('INSERT INTO eva_assisted_closing_versions(id,organization_id,customer_id,month,payload_hash,report,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,'org','customer','2026-03',hash,report,{}]);
  const pubs=JSON.stringify([{id:'pub-cost',closingId:id,state:'PUBLISHED',publishedAt:'2026-10-22T12:00:00Z',projection:{customerId:'customer',month:'2026-03'}}]);
  const modern=JSON.stringify([{publicationId:'pub-cost',sourceHash:hash,unitId:'unit',customerId:'customer',month:'2026-03'}]);
  await db.exec(`CREATE OR REPLACE FUNCTION public.read_eva_closing_publications(text,text,text,boolean,boolean,text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '${pubs}'::jsonb$$;CREATE OR REPLACE FUNCTION public.read_eva_published_components(text,text,text,boolean,boolean,text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '${modern}'::jsonb$$;`);
  const result=(await db.query("SELECT read_portal_financial_components_v2('org','actor','role',false,true,'2026-03','2026-03','customer') AS data")).rows[0].data;
  ok(result.length===1);ok(result[0].publishedCostItems.length===1);ok(result[0].publishedCostItems[0].id==='ccee');ok(result[0].publishedCostItems[0].amount==='5.00');
  const perms=(await db.query("SELECT has_function_privilege('authenticated','public.read_portal_financial_components_v2(text,text,text,boolean,boolean,text,text,text)','EXECUTE') AS direct,has_function_privilege('service_role','public.read_portal_financial_components_v2(text,text,text,boolean,boolean,text,text,text)','EXECUTE') AS server")).rows[0];ok(!perms.direct&&perms.server);
 }finally{await db.exec('ROLLBACK');}
};
