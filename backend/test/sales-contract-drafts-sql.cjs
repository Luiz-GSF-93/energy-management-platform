// Reuse the disposable offer fixtures without touching production or copying customer data.
const fs=require('fs');
const contractTests=String.raw`{
await db.exec(fs.readFileSync('src/database/migrations/20261010_platform_sales_offer_document.sql','utf8'));
const migration=fs.readFileSync('src/database/migrations/20261010_platform_sales_contract_drafts.sql','utf8');await db.exec(migration);await db.exec(migration);
const run=(action,body,actor=owner)=>db.query('select platform_sales_contract_action($1,$2,$3) result',[actor,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
const modelId=id(200),draftId=id(300),definition={title:'Fixture internal model',clauses:[{title:'Fixture clause',text:'Fixture text approved for testing only.'}]};
const template={id:modelId,requestId:id(201),expectedRevision:0,definition,justification:'Fixture model justification.'};
const rev=(n,kind='template',entity=modelId,version=1,status='CHECKED',revision=1)=>({id:entity,requestId:id(n),kind,revision,expectedVersion:version,status,justification:'Fixture review justification.'});
const list={page:0,search:'',status:''};
await reject(()=>run('list',list,other),'42501');await reject(()=>run('list',list,null),'42501');
await reject(()=>run('template',{...template,definition:{}}));await reject(()=>run('template',{...template,definition:{...definition,extra:'invented'}}));
await run('template',{...template,id:id(211),requestId:id(212),definition:{...definition,clauses:[{title:'Pending clause',text:'[PENDENTE: completar condições antes de aprovar]'}]}});await reject(()=>run('review',rev(213,'template',id(211))));
const model=await run('template',template);assert.deepEqual(await run('template',template),model);checks++;
await reject(()=>run('template',{...template,definition:{...definition,title:'Changed model'}}),'P3611');
await reject(()=>run('review',rev(202,'template',modelId,1,'APPROVED_INTERNAL')));
const party={name:'Fixture company',document:'Fixture document',address:'Fixture address',signatory:'Fixture signatory',email:'fixture@example.com'};
const body={id:draftId,proposalId:id(2),termsRevision:2,templateId:modelId,templateRevision:1,parties:{supplier:party,customer:party},justification:'Fixture draft justification.'};
await reject(()=>run('prepare',body),'P3611');await run('review',rev(203));await run('review',rev(204,'template',modelId,2,'APPROVED_INTERNAL'));
for(const bad of [null,[],{}, {supplier:party,customer:{...party,role:'Owner'}},{supplier:party,customer:{...party,email:'invalid'}},{supplier:party,customer:{...party,signatory:''}}])await reject(()=>run('prepare',{...body,parties:bad}));
await reject(()=>run('prepare',{...body,proposalId:id(900)}),'P3610');await reject(()=>run('prepare',{...body,termsRevision:7}),'P3611');
const snapshot=await run('prepare',body);assert.equal(snapshot.proposal.snapshot.monthlyBaseCents,85000);checks++;
const pdf=Buffer.from('%PDF-1.7\n'+'.'.repeat(200)+'\n%%EOF'),store={...body,requestId:draftId,snapshot,rendererVersion:'contract-draft-v1',hex:pdf.toString('hex')};
await reject(()=>run('store',{...store,snapshot:{...snapshot,proposal:{...snapshot.proposal,snapshot:{currency:'USD'}}}}),'P3611');
await reject(()=>run('store',{...store,rendererVersion:null}));await reject(()=>run('store',{...store,hex:null}));
const saved=await run('store',store);assert.deepEqual(await run('store',store),saved);checks++;
await reject(()=>run('store',{...store,justification:'Changed justification.'}),'P3611');
const file=await run('pdf',{id:draftId});assert.equal(file.hex,pdf.toString('hex'));assert.equal(file.sha256,require('crypto').createHash('sha256').update(pdf).digest('hex'));checks++;
assert.equal((await run('read',{id:draftId})).snapshot.parties.customer.name,party.name);assert(!JSON.stringify(await run('list',list)).includes('fixture@example.com'));checks++;
await reject(()=>run('review',rev(305,'draft',draftId,1,'SIGNED')));await reject(()=>run('review',rev(305,'draft',draftId,1,'APPROVED_INTERNAL')));
await run('review',rev(306,'draft',draftId));await run('review',rev(307,'draft',draftId,2,'APPROVED_INTERNAL'));
await db.exec('DROP TABLE user_profiles');await reject(()=>run('list',list),'42P01');await db.exec('CREATE TABLE user_profiles(user_id uuid,full_name text)');
await db.query('insert into user_profiles values($1,$2)',[owner,'New current name']);
assert.equal((await run('read',{id:draftId})).actor_name,null);await run('template',{...template,requestId:id(208),expectedRevision:1,definition:{...definition,title:'New template revision'}});checks++;
assert.equal((await run('read',{id:draftId})).snapshot.template.definition.title,definition.title);checks++;
const racing=await Promise.allSettled([run('template',{...template,requestId:id(209),expectedRevision:2}),run('template',{...template,requestId:id(210),expectedRevision:2})]);assert.equal(racing.filter(x=>x.status==='fulfilled').length,1);checks++;
for(const [i,profile] of ['ADMINISTRATOR','FINANCE','SUPPORT','OPERATOR'].entries()){const actor=id(40+i);for(const action of ['list','prepare','read','pdf','review','store','template'])await reject(()=>run(action,action==='list'?list:action==='template'?template:action==='review'?rev(400+i):action==='store'?store:body,actor),'42501');}
await db.exec('SET ROLE service_role');await run('read',{id:draftId});await reject(()=>db.query('select * from platform_sales_contract_drafts'),'42501');await reject(()=>db.query('select platform_sales_contract_snapshot($1,$2,2,$3,1,$4)',[owner,id(2),modelId,JSON.stringify(body.parties)]),'42501');await db.exec('RESET ROLE');
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>run('pdf',{id:draftId}),'42501');await db.exec('RESET ROLE');}
await reject(()=>db.query('delete from platform_sales_contract_events'),'42501');await reject(()=>db.query('update platform_sales_contract_drafts set justification=$1',['changed']),'42501');
assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;
console.log('Contract checks and offer regression checks: '+checks); }
`;
const fixture=fs.readFileSync('test/sales-offer-terms-sql.cjs','utf8').replace('await db.close();console.log(',contractTests+'\nawait db.close();console.log(');
new Function('require',fixture)(require);
