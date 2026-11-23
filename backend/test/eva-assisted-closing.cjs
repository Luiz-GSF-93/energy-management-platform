const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),pglite=require('@electric-sql/pglite');
let PGlite=pglite.PGlite;
if(process.env.EVA_CLOSING_TEST_PG_PORT){if(process.env.EVA_CLOSING_TEST_PG_PORT!=='55484')throw Error('Disposable loopback only');const {Pool}=require('pg');PGlite=class{constructor(){this.ready=(async()=>{const a=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres'});await a.query('CREATE DATABASE eva_assisted_closing_test');await a.end();this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'eva_assisted_closing_test',max:4})})();}async exec(sql){await this.ready;return this.pool.query(sql)}async query(sql,args){await this.ready;return this.pool.query(sql,args)}async close(){await this.ready;return this.pool.end()}};}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
 const fixture=fs.readFileSync(path.join(__dirname,'calculation-autofill.cjs'),'utf8').split('await db.exec(`')[1].split('`);')[0].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/\$\{'a'\.repeat\(64\)\}/g,'a'.repeat(64));await db.exec(process.env.EVA_CLOSING_TEST_PG_PORT?fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;',''):fixture);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261109_calculation_autofill.sql'),'utf8'));
 await db.exec(`CREATE TABLE tariff_library_versions(id text,organization_id text);CREATE TABLE monthly_energy_settlements(id text,organization_id text,customer_id text,consumer_unit_id text,month date,version_number integer,financial_hash text,status text,validation_status text,approved_at timestamptz,published_at timestamptz,financial_format text);
 CREATE FUNCTION capture_financial_sources(text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('largeProof',repeat('private snapshot evidence ',40000),'tables',jsonb_build_object('consumer_units',(SELECT jsonb_agg(to_jsonb(u)) FROM public.consumer_units u WHERE organization_id=$1 AND customer_id=$2)))$$;
 INSERT INTO roles SELECT 'manager',organization_id,scope,'admin_org',permissions FROM roles WHERE id='operator';INSERT INTO organization_members VALUES('org','${id(24)}','manager','ACTIVE',null,'internal');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261110_eva_assisted_closing.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261221_eva_closing_history_projection.sql'),'utf8'));
 // Re-applying the guarded performance migration preserves the exact interface.
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261221_eva_closing_history_projection.sql'),'utf8'));
 const call=(action,idArg,body,actor=id(20),role='operator',org='org')=>db.query('SELECT eva_assisted_closing_action($1,$2,$3,false,$4,$5,$6,$7,$8) data',[org,actor,role,action,id(1),'2026-08',idArg,JSON.stringify(body)]).then(r=>r.rows[0].data);
 let sources=await call('capture',null,{});
 const financial={status:'AVAILABLE',acr:'1000.00',aclBeforeFees:'700.00',fixedFee:'50.00',variableFee:'0.00',totalFees:'50.00',aclAfterFees:'750.00',savings:'250.00'};
 const report={formatVersion:'eva-assisted-closing-1.0',organizationId:'org',customerId:'customer',month:'2026-08',unitIds:[id(1)],units:[{id:id(1),...financial}],completeness:'COMPLETE',approvalEligible:true,missing:[],financial,publicationAllowed:false,automaticApproval:false};
 const b={basis:'b'.repeat(64),hash:'c'.repeat(64),sources,report};
 ok((await call('history',null,{page:0})).total===0);
 for(const actor of [id(22),id(23),id(50)])await deny(()=>call('reserve',id(30),b,actor));
 await deny(()=>call('reserve',id(30),{...b,report:{...report,completeness:null}}));
 const concurrent=await Promise.all([call('reserve',id(30),b),call('reserve',id(30),b)]);ok(concurrent.filter(r=>r.acquired).length===1);ok(concurrent.every(r=>r.row.id===concurrent[0].row.id));
 ok((await call('finish',id(30),{})).state==='READY_FOR_REVIEW');
 const decision={decision:'APPROVE',hash:b.hash,acknowledge:true,note:'Fontes conferidas na simulação descartável.'};
 await deny(()=>call('decide',id(30),decision));await deny(()=>call('decide',id(30),{...decision,decision:null},id(24),'manager'));
 ok((await call('decide',id(30),decision,id(24),'manager')).state==='APPROVED');ok((await call('decide',id(30),decision,id(24),'manager')).state==='APPROVED');
 await deny(()=>call('decide',id(30),{...decision,decision:'REJECT'},id(24),'manager'));
 const h=await call('history',null,{page:0});ok(h.rows.length===1&&!('source_snapshot' in h.rows[0]));
 const stored=(await db.query('SELECT * FROM eva_assisted_closing_versions WHERE id=$1',[id(30)])).rows[0];
 ok(stored.source_snapshot.financial.largeProof.length>500000);
 for(const key of ['id','organization_id','customer_id','consumer_unit_id','month','version','previous_id','basis','payload_hash','report','created_by'])assert.deepEqual(h.rows[0][key],stored[key]);
 ok(JSON.stringify(h.rows[0]).length<5000);
 const definition=(await db.query("SELECT pg_get_functiondef('eva_assisted_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb)'::regprocedure) definition")).rows[0].definition;
 ok(!/to_jsonb\((?:t|r|old)\)-'source_snapshot'/.test(definition));
 ok(definition.includes('r.source_snapshot IS DISTINCT FROM public.capture_eva_assisted_closing_sources')); 
 for(const table of ['eva_assisted_closing_versions','eva_assisted_closing_events']){
  await deny(()=>db.query('UPDATE '+table+' SET organization_id=organization_id'));
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,table,privilege])).rows[0].p);
 }
 // A changed capture invalidates approval but permits explicit rejection and another immutable revision.
 const b2={...b,basis:'d'.repeat(64)};await call('reserve',id(32),b2);await call('finish',id(32),{});await db.exec(`INSERT INTO tariff_library_versions VALUES('changed','org')`);
 await deny(()=>call('decide',id(32),decision,id(24),'manager'));
 ok((await call('decide',id(32),{...decision,decision:'REJECT'},id(24),'manager')).state==='REJECTED');
 sources=await call('capture',null,{});ok((await call('reserve',id(33),{...b,basis:'e'.repeat(64),sources})).acquired);ok((await call('finish',id(33),{})).state==='READY_FOR_REVIEW');
 await deny(()=>call('history',null,{page:0},id(20),'operator','other'));

 await db.exec('CREATE TABLE unit_demand_periods(id uuid,organization_id text,customer_id text,consumer_unit_id text,document_id text,document_hash text);CREATE TABLE unit_demand_approvals(period_id uuid,organization_id text,consumer_unit_id text)');
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261280_eva_unit_closing_scope.sql'),'utf8'));
 await db.exec(`INSERT INTO consumer_units VALUES('${id(3)}','org','customer','ACTIVE')`);
 const scoped=(action,u,rid,body,scope='UNIT',actor=id(20),role='operator',org='org')=>db.query('SELECT eva_scoped_closing_action($1,$2,$3,false,$4,$5,$6,$7,$8,$9,$10,false) data',[org,actor,role,action,u,'2026-08',rid,JSON.stringify(body),scope,'BASE']).then(r=>r.rows[0].data);
 sources=await scoped('capture',id(1),null,{});
 const ub={...b,basis:'1'.repeat(64),sources,report:{...report,scope:{kind:'UNIT',unitIds:[id(1)]}}};
 ok((await scoped('reserve',id(1),id(41),ub)).acquired);
 ok((await scoped('finish',id(1),id(41),{})).state==='READY_FOR_REVIEW');
 ok((await scoped('history',id(1),null,{page:0})).total===1);
 ok((await scoped('history',id(3),null,{page:0})).total===0);
 await deny(()=>scoped('reserve',id(1),id(42),{...ub,report:{...ub.report,scope:{kind:'UNIT',unitIds:[id(3)]}}}));
 await deny(()=>scoped('finish',id(3),id(41),{}));
 await deny(()=>scoped('history',id(1),null,{page:0},'UNIT',id(20),'operator','other'));
 ok((await call('history',null,{page:0})).total===3);
 ok((await scoped('decide',id(1),id(41),{...decision,hash:ub.hash},'UNIT',id(24),'manager')).state==='APPROVED');
 ok((await db.query("SELECT current_setting('energyos.eva_closing_scope',true) scope")).rows[0].scope==='');
 sources=await call('capture',null,{});
 const customerReport={...report,unitIds:[id(1),id(3)],units:[{id:id(1),...financial},{id:id(3),...financial}],financial:{...financial,...Object.fromEntries(Object.entries(financial).filter(([k])=>k!=='status').map(([k,v])=>[k,(Number(v)*2).toFixed(2)]))}};
 const next=await call('reserve',id(43),{...b,basis:'2'.repeat(64),sources,report:customerReport});ok(next.acquired&&next.row.version>4);

 await db.exec(`CREATE OR REPLACE FUNCTION capture_financial_sources(text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('tables',jsonb_build_object('consumer_units',(SELECT jsonb_agg(to_jsonb(u)) FROM public.consumer_units u WHERE organization_id=$1 AND customer_id=$2),'management_contracts',jsonb_build_array(jsonb_build_object('savings_percentage',8))))$$;`);
 const sharedSources=await scoped('capture',id(1),null,{}),sharedBody={...ub,basis:'3'.repeat(64),sources:sharedSources};
 await scoped('reserve',id(1),id(44),sharedBody);await scoped('finish',id(1),id(44),{});
 await deny(()=>scoped('decide',id(1),id(44),{...decision,hash:sharedBody.hash},'UNIT',id(24),'manager'));
 ok((await scoped('history',id(1),null,{page:0})).rows[0].state==='READY_FOR_REVIEW');

 // Regression: explicit monthly unit fees must pass the SQL approval gate too.
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261332_eva_unit_fee_approval.sql'),'utf8'));

 // Production already contains the dated active-contract guard. Accept that exact
 // baseline as well, preserving the later period correction.
 const productionGuard="IF p_scope='UNIT' AND p_action IN('publish','decide') AND (p_action='publish' OR p_body->>'decision'='APPROVE') AND (SELECT count(*) FROM public.consumer_units WHERE organization_id=p_org AND customer_id=r.customer_id AND status='ACTIVE')>1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.source_snapshot#>'{financial,tables,management_contracts}','[]')) m WHERE m->>'status'='ACTIVE' AND coalesce(m->>'start_date','')<=to_char((p_month||'-01')::date+interval '1 month'-interval '1 day','YYYY-MM-DD') AND coalesce(m->>'end_date','9999-12-31')>=p_month||'-01' AND coalesce(nullif(m->>'savings_percentage',''),'0')::numeric>0) THEN RAISE EXCEPTION 'Shared variable fee requires consolidated closing' USING ERRCODE='22023';END IF;";
 const scopedSignature='public.eva_scoped_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,text,text,boolean)';
 const patchedDefinition=(await db.query('SELECT pg_get_functiondef($1::regprocedure) d',[scopedSignature])).rows[0].d;
 const currentGuard=patchedDefinition.match(/IF p_scope='UNIT' AND p_action IN\('publish','decide'\)[^;]*;END IF;/)[0];
 await db.exec(patchedDefinition.replace(currentGuard,productionGuard));
 await db.exec('DROP FUNCTION public.eva_unit_fee_requires_consolidation(jsonb,text,text,text)');
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261332_eva_unit_fee_approval.sql'),'utf8'));
 ok((await db.query('SELECT pg_get_functiondef($1::regprocedure) d',[scopedSignature])).rows[0].d.includes('AND public.eva_unit_fee_requires_consolidation'));
 const contract={id:'fee',organization_id:'org',customer_id:'customer',status:'ACTIVE',start_date:'2026-01-01',end_date:'2026-12-31',savings_percentage:8};
 const rule={id:'unit-rule',organization_id:'org',customer_id:'customer',contract_id:'fee',month:'2026-08',version:1,source:'Explicit unit fee rule',fixed_fee_basis:'PER_UNIT',variable_fee_basis:'PER_UNIT',allocations:[]};
 const snap=(contracts=[contract],rules=[rule])=>({financial:{tables:{management_contracts:contracts,management_fee_allocations:rules}}});
 const requires=async(snapshot,org='org',customer='customer',month='2026-08')=>(await db.query('SELECT public.eva_unit_fee_requires_consolidation($1,$2,$3,$4) blocked',[JSON.stringify(snapshot),org,customer,month])).rows[0].blocked;
 ok(!await requires(snap()));
 for(const patch of [{month:'2026-07'},{organization_id:'other'},{customer_id:'other'},{contract_id:'other'},{source:'  '},{variable_fee_basis:'CONSOLIDATED'},{fixed_fee_basis:'CONSOLIDATED'},{allocations:[{consumerUnitId:id(1),percentage:'100'}]},{version:0}])ok(await requires(snap([contract],[{...rule,...patch}])));
 ok(await requires(snap([contract],[])));ok(await requires(snap([contract],[rule,{...rule,id:'duplicate'}])));
 ok(await requires(snap([contract],[rule,{...rule,version:2,variable_fee_basis:'CONSOLIDATED'}])));
 ok(!await requires(snap([contract],[{...rule,variable_fee_basis:'CONSOLIDATED'}, {...rule,version:2}])));
 ok(await requires(snap(),'other'));ok(await requires(snap(),'org','other'));ok(await requires(snap(),'org','customer','2026-09'));
 ok(!await requires(snap([{...contract,end_date:'2026-07-31'}],[])));
 ok(await requires(snap([contract,{...contract,id:'unconfigured'}])));
 ok(await requires(snap([{...contract,status:null}])));
 for(const role of ['anon','authenticated','service_role'])ok(!(await db.query("SELECT has_function_privilege($1,'public.eva_unit_fee_requires_consolidation(jsonb,text,text,text)','EXECUTE') allowed",[role])).rows[0].allowed);
 // The current scoped function keeps downstream membership, financial freshness and hash checks.
 const capture=async rules=>db.exec(`CREATE OR REPLACE FUNCTION capture_financial_sources(text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('tables',jsonb_build_object('consumer_units',(SELECT jsonb_agg(to_jsonb(u)) FROM public.consumer_units u WHERE organization_id=$1 AND customer_id=$2),'management_contracts','${JSON.stringify([contract])}'::jsonb,'management_fee_allocations','${JSON.stringify(rules)}'::jsonb))$$;`);
 await capture([rule]);sources=await scoped('capture',id(1),null,{});
 const unitBody={...ub,basis:'4'.repeat(64),sources};
 await scoped('reserve',id(1),id(45),unitBody);await scoped('finish',id(1),id(45),{});
 await deny(()=>scoped('decide',id(1),id(45),decision));
 await deny(()=>scoped('decide',id(1),id(45),{...decision,hash:'0'.repeat(64)},'UNIT',id(24),'manager'));
 ok((await scoped('decide',id(1),id(45),decision,'UNIT',id(24),'manager')).state==='APPROVED');
 const eventCount=(await db.query('SELECT count(*) n FROM eva_assisted_closing_events WHERE closing_id=$1',[id(45)])).rows[0].n;
 ok((await scoped('decide',id(1),id(45),decision,'UNIT',id(24),'manager')).state==='APPROVED');
 ok((await db.query('SELECT count(*) n FROM eva_assisted_closing_events WHERE closing_id=$1',[id(45)])).rows[0].n===eventCount);
 await capture([{...rule,version:2,variable_fee_basis:'CONSOLIDATED'}]);
 sources=await scoped('capture',id(1),null,{});const blockedBody={...ub,basis:'5'.repeat(64),sources};
 await scoped('reserve',id(1),id(46),blockedBody);await scoped('finish',id(1),id(46),{});
 await assert.rejects(()=>scoped('decide',id(1),id(46),decision,'UNIT',id(24),'manager'),e=>e.message==='Shared variable fee requires consolidated closing');checks++;
 ok((await scoped('history',id(1),null,{page:0})).rows[0].state==='READY_FOR_REVIEW');


 // Sibling preparation receipts cannot invalidate an independent unit closing.
 await capture([rule]);
 const sourceGuard=fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261353_eva_unit_commercial_source_consistency.sql'),'utf8');
 await db.exec(sourceGuard);await db.exec(sourceGuard);await call('finish',id(43),{});
 const commercial=[{id:'own-receipt',consumer_unit_id:id(1),state:'PARTIAL',source_hash:'a'.repeat(64),source_basis:'b'.repeat(64),manual:{price:'10.00'},author:id(20)},{id:'sibling-receipt',consumer_unit_id:id(3),state:'PARTIAL',source_hash:'d'.repeat(64),source_basis:'e'.repeat(64),manual:{price:'20.00'},author:id(20)}];
 await db.exec('CREATE TABLE test_commercial_sources(payload jsonb)');await db.query('INSERT INTO test_commercial_sources VALUES($1)',[JSON.stringify(commercial)]);
 const capturedDefinition=(await db.query("SELECT pg_get_functiondef('public.capture_eva_assisted_closing_sources(text,text,text)'::regprocedure) d")).rows[0].d;
 assert(capturedDefinition.includes('RETURN base;'));
 await db.exec(capturedDefinition.replace('RETURN base;',"RETURN jsonb_set(base,'{commercial}',(SELECT payload FROM public.test_commercial_sources));"));
 const setCommercial=rows=>db.query('UPDATE test_commercial_sources SET payload=$1',[JSON.stringify(rows)]);
 const matches=(a,b,scope='UNIT',u=id(1))=>db.query('SELECT eva_closing_sources_match($1,$2,$3,$4) value',[JSON.stringify(a),JSON.stringify(b),scope,u]).then(r=>r.rows[0].value);
 const baseSources=await scoped('capture',id(1),null,{}),changedSibling={...commercial[1],id:'new-sibling-receipt',source_basis:'f'.repeat(64)};
 const siblingSources={...baseSources,commercial:[commercial[0],changedSibling]};
 ok(await matches(baseSources,siblingSources));ok(!await matches(baseSources,siblingSources,'CUSTOMER'));
 for(const change of [{source_hash:'0'.repeat(64)},{source_basis:'0'.repeat(64)},{manual:{price:'99.00'}},{author:id(24)},{state:'RUNNING'},{state:'UNKNOWN'}])ok(!await matches(baseSources,{...baseSources,commercial:[{...commercial[0],...change},commercial[1]]}));
 for(const key of ['financial','libraries','previous','documentedSupplierDocuments','demandDocuments','operationalFlow','contractMemories'])ok(!await matches(baseSources,{...baseSources,[key]:{changed:true}}));
 for(const malformed of [{...baseSources,commercial:{}},{...baseSources,commercial:[{},commercial[0]]},{...baseSources,commercial:[commercial[0],commercial[0]]}])ok(!await matches(baseSources,malformed));
 ok(!await matches(baseSources,baseSources,'INVALID'));ok(!await matches(null,baseSources));
 for(const role of ['anon','authenticated','service_role'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_closing_sources_match(jsonb,jsonb,text,text)','EXECUTE') value",[role])).rows[0].value);
 await setCommercial([commercial[0],changedSibling]);
 const independent={...ub,basis:'6'.repeat(64),sources:baseSources};
 ok((await scoped('reserve',id(1),id(70),independent)).acquired);
 await setCommercial([commercial[0],{...changedSibling,id:'sibling-after-reserve'}]);
 ok((await scoped('finish',id(1),id(70),{})).state==='READY_FOR_REVIEW');
 await setCommercial([commercial[0],{...changedSibling,id:'sibling-before-approval'}]);
 await deny(()=>scoped('decide',id(1),id(70),decision));
 await deny(()=>scoped('decide',id(1),id(70),{...decision,hash:'0'.repeat(64)},'UNIT',id(24),'manager'));
 await deny(()=>scoped('decide',id(1),id(70),decision,'UNIT',id(24),'manager','other'));
 ok((await scoped('decide',id(1),id(70),decision,'UNIT',id(24),'manager')).state==='APPROVED');
 const retained=(await db.query('SELECT source_snapshot,payload_hash FROM eva_assisted_closing_versions WHERE id=$1',[id(70)])).rows[0];assert.deepEqual(retained.source_snapshot,baseSources);ok(retained.payload_hash===independent.hash);
 const eventTotal=(await db.query('SELECT count(*) count FROM eva_assisted_closing_events WHERE closing_id=$1',[id(70)])).rows[0].count;
 await scoped('decide',id(1),id(70),decision,'UNIT',id(24),'manager');ok((await db.query('SELECT count(*) count FROM eva_assisted_closing_events WHERE closing_id=$1',[id(70)])).rows[0].count===eventTotal);
 const ownSources=await scoped('capture',id(1),null,{});await scoped('reserve',id(1),id(71),{...ub,basis:'7'.repeat(64),sources:ownSources});await scoped('finish',id(1),id(71),{});
 await setCommercial([{...commercial[0],manual:{price:'99.00'}},changedSibling]);await deny(()=>scoped('decide',id(1),id(71),decision,'UNIT',id(24),'manager'));
 await setCommercial(commercial);
 const librarySources=await scoped('capture',id(1),null,{});await scoped('reserve',id(1),id(72),{...ub,basis:'8'.repeat(64),sources:librarySources});await scoped('finish',id(1),id(72),{});
 await db.exec("INSERT INTO tariff_library_versions VALUES('real-source-change','org')");await deny(()=>scoped('decide',id(1),id(72),decision,'UNIT',id(24),'manager'));
 await db.exec("DELETE FROM tariff_library_versions WHERE id='real-source-change'");
 const consolidatedSources=await scoped('capture',id(1),null,{},'CUSTOMER');await scoped('reserve',id(1),id(73),{...b,basis:'9'.repeat(64),sources:consolidatedSources,report:customerReport},'CUSTOMER');
 await setCommercial([commercial[0],changedSibling]);ok((await scoped('finish',id(1),id(73),{},'CUSTOMER')).state==='INCOMPLETE');
 await deny(()=>db.query('UPDATE eva_assisted_closing_versions SET source_snapshot=source_snapshot WHERE id=$1',[id(70)]));

 console.log('Assisted closing SQL:',checks,'checks passed');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});

