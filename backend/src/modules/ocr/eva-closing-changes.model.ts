import {repriceComponentGross} from './invoice-component-tax-v3';
import {documentedLineAmount} from './documented-tariff-period';
import {historicalDifference} from './eva-assisted-closing.model';
import {autofillHash} from './calculation-autofill.model';
import {allocateFee} from '../contracts/services/management-fee';
import {tariffProduct} from '../contracts/services/tariff-preview';
export type ClosingChange={unitId:string;kind:'AMOUNT'|'PERCENT'|'TARIFF'|'QUANTITY'|'TAX';target:string;value?:string;scenario?:'ACR'|'ACL';mode?:'FIXED'|'INSIDE'|'OUTSIDE';rate?:string;base?:string;baseLabel?:string};
const dec=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})(\.\d{1,6})?$/.test(v);
const scale=(v:unknown)=>{if(!dec(v))throw Error('Valor decimal inválido.');const [w,f='']=v.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
const cents=(v:unknown)=>{if(typeof v!=='string'||! /^-?(0|[1-9][0-9]{0,11})(\.\d{1,2})?$/.test(v))throw Error('Valor monetário inválido.');const [w,f='']=v.replace('-','').split('.');return (BigInt(w)*100n+BigInt(f.padEnd(2,'0')))*(v.startsWith('-')?-1n:1n);};
const fmt=(n:bigint)=>{const s=(n<0n?-n:n).toString().padStart(3,'0');return (n<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
const round=(n:bigint,d:bigint)=>{if(d<=0n)throw Error('Base inválida.');return (n<0n?-1n:1n)*(((n<0n?-n:n)+d/2n)/d);};
const normal=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const isChangeRequest=(q:string)=>/\b(alter[ae]|alterar|ajust[ae]|ajustar|corrij[ae]|corrigir|substitu[ai]|substituir|mude|mudar|recalcul[ae]|recalcular|modifique|modificar|aumente|reduza|troque)\b/.test(normal(q))&&!/^\s*(como|por que|porque|posso|qual)\b/.test(normal(q));
/** Restricted natural-language grammar. Unknown or ambiguous instructions never execute. */
export function parseClosingChanges(question:string,unitId:string):ClosingChange[]{
 if(typeof question!=='string'||question.length>2000||!isChangeRequest(question))throw Error('Diga qual valor deseja alterar. Perguntas não alteram o fechamento.');
 if(/\b(todas|todos|outra unidade|outro cliente|outro mes)\b/.test(normal(question)))throw Error('A proposta se aplica à unidade e competência selecionadas. Selecione a unidade desejada; ajustes de várias unidades exigem propostas explícitas por unidade.');
 const clauses=question.split(/[;\n]+/).map(s=>normal(s).trim()).filter(Boolean);if(!clauses.length||clauses.length>12)throw Error('Informe até 12 ajustes separados por ponto e vírgula.');
 const changes:ClosingChange[]=[];
 for(const s of clauses){
  if(/\b(ou|talvez|se)\b/.test(s))throw Error('O pedido tem alternativas ou condições. Informe um ajuste definido para a prévia.');
  const num='(0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?';
  const valueAfter=(label:string)=>{const m=s.match(new RegExp(label+'\\s*(?:para|=|:)\\s*(?:r\\$\\s*)?('+num+')(?=\\s|%|$)'));return m?.[1].replace(',','.');};
  const tax=s.match(/\b(icms|pis|cofins)\b/),scenario=s.match(/\b(acr|acl)\b/g);
  if(tax){
   if(new Set(s.match(/\b(icms|pis|cofins)\b/g)).size!==1||/honorario|fornecedor|tarifa|quantidade|custo adicional|credito adicional/.test(s))throw Error('Separe cada imposto e demais campos por ponto e vírgula.');
   if(!scenario||new Set(scenario).size!==1)throw Error('Informe o cenário ACR ou ACL do imposto.');
   const mode=s.includes('por dentro')?'INSIDE':s.includes('por fora')?'OUTSIDE':s.includes('valor fixo')?'FIXED':null;
   if(!mode||s.includes('por dentro')&&s.includes('por fora'))throw Error('Informe valor fixo, por dentro ou por fora e a base do imposto.');
   if(mode==='FIXED'){const value=valueAfter('valor fixo');if(!value)throw Error('Exemplo: alterar ICMS ACR valor fixo para 900.00.');changes.push({unitId,kind:'TAX',target:tax[1].toUpperCase(),scenario:scenario[0].toUpperCase() as any,mode,value});}
   else{const r=s.match(new RegExp('('+num+')\\s*%')),base=valueAfter('base');if(!r||!base||(s.match(/%/g)??[]).length!==1||(s.match(/\bbase\s*(?:para|=|:)/g)??[]).length!==1)throw Error('Informe alíquota e base em reais. Exemplo: alterar ICMS ACR para 18% por dentro base: 1000.00. A base informada será registrada como premissa do operador.');changes.push({unitId,kind:'TAX',target:tax[1].toUpperCase(),scenario:scenario[0].toUpperCase() as any,mode,rate:r[1].replace(',','.'),base,baseLabel:'Base independente em reais informada pelo operador no comando; não é base fiscal confirmada.'});}
  }else{
   const rules:[RegExp,ClosingChange['kind'],string][]=[[/honorario\s+fixo/,'AMOUNT','fixedFee'],[/honorario\s+variavel/,'PERCENT','feePercentage'],[/preco\s+(?:do\s+)?fornecedor/,'AMOUNT','supplierPrice'],[/valor\s+(?:do\s+)?fornecedor/,'AMOUNT','supplier'],[/total\s+(?:da\s+)?(?:fatura|distribuidora)/,'AMOUNT','invoice'],[/custo\s+adicional\s+acr/,'AMOUNT','extraAcr'],[/custo\s+adicional\s+acl/,'AMOUNT','extraAcl'],[/credito\s+adicional\s+acr/,'AMOUNT','creditAcr'],[/credito\s+adicional\s+acl/,'AMOUNT','creditAcl']];
   const matches=rules.filter(([r])=>r.test(s));
   if(matches.length===1){const [,kind,target]=matches[0],m=s.match(new RegExp('(?:para|=|:)\\s*(?:r\\$\\s*)?('+num+')(?=\\s|%|$)'));if(!m)throw Error('Informe o novo valor, sem separador de milhar.');changes.push({unitId,kind,target,value:m[1].replace(',','.')});}
   else{
    const component=s.match(/\b(te|tusd energia|demanda)\b/),period=s.includes('fora ponta')?'OFF_PEAK':s.includes('ponta')?'PEAK':s.includes('todos')?'ALL':null;
    const tariff=/\btarifa\b/.test(s),quantity=/\bquantidade\b/.test(s),m=s.match(new RegExp('(?:para|=|:)\\s*('+num+')(?=\\s|$)'));
    if(matches.length||!component||!period||tariff===quantity||!m||!/\bacr\b/.test(s))throw Error('Não identifiquei um ajuste único. Informe campo, cenário e valor; para tarifa/quantidade ACR, informe componente e posto. Separe ajustes por ponto e vírgula.');
    changes.push({unitId,kind:tariff?'TARIFF':'QUANTITY',target:({te:'TE','tusd energia':'TUSD_ENERGY',demanda:'TUSD_DEMAND_USED'} as any)[component[0]]+':'+period,value:m[1].replace(',','.')});
   }
  }
 }
 if(new Set(changes.map(x=>x.unitId+':'+x.kind+':'+x.target+':'+(x.scenario??''))).size!==changes.length)throw Error('O mesmo campo foi solicitado mais de uma vez.');
 return changes;
}
/** Pure calculation over an immutable source. No OCR writes, licensing or model calls. */
export function reviseClosing(source:any,changes:ClosingChange[],question:string){
 if(!source||source.approvalEligible!==true||!['SAME_INVOICE_AMOUNTS_V2','COMPONENT_TAXES_V3','EVA_CONFIRMED_CHANGES_V1'].includes(source.methodology)||!Array.isArray(source.units)||!source.units.length||source.units.length>100||!changes.length||changes.length>12)throw Error('Selecione um comparativo completo e compatível para corrigir.');
 const canonical=(v:string)=>v.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 changes=changes.map(x=>({...x,...(dec(x.value)?{value:canonical(x.value)}:{}),...(dec(x.rate)?{rate:canonical(x.rate)}:{}),...(dec(x.base)?{base:canonical(x.base)}:{})}));
 const report=JSON.parse(JSON.stringify(source)),diff:any[]=[];
 for(const x of changes){
  const u=report.units.find((u:any)=>u.id===x.unitId);if(!u||u.missing?.length||!['SAME_INVOICE_AMOUNTS_V2','COMPONENT_TAXES_V3'].includes(u.methodology?.method))throw Error('Unidade sem memória compatível.');
  u.changeBase??={acr:u.acr,aclBeforeFees:u.aclBeforeFees,fixedFee:u.fixedFee,feePercentage:u.feePercentage};
  u.adjustments??={};const a=u.adjustments,key=x.kind+':'+x.target+':'+(x.scenario??''),before=a[key]??null;
  if(Object.keys(x).some(k=>!['unitId','kind','target','value','scenario','mode','rate','base','baseLabel'].includes(k)))throw Error('Operação desconhecida.');
  if(x.kind==='TAX'){
   if(!['ICMS','PIS','COFINS'].includes(x.target)||!['ACL','ACR'].includes(x.scenario!))throw Error('Imposto ou cenário inválido.');
   const tax=(x.scenario==='ACR'&&u.methodology.acrTaxes?u.methodology.acrTaxes:u.methodology.taxes)?.find((t:any)=>t.code===({ICMS:'icmsAmount',PIS:'pisAmount',COFINS:'cofinsAmount'} as any)[x.target]);if(!tax)throw Error('Imposto original sem conciliação.');
   let amount:string;
   if(x.mode==='FIXED'){if(x.rate!==undefined||x.base!==undefined||!dec(x.value))throw Error('Valor fixo inválido.');amount=fmt(cents(x.value));}
   else{if(!['INSIDE','OUTSIDE'].includes(x.mode!)||x.value!==undefined||!dec(x.rate)||!dec(x.base)||scale(x.rate)>=100000000n||!x.baseLabel||x.baseLabel.length>300)throw Error('Alíquota, base e tratamento explícitos são necessários.');const base=cents(x.base),rate=scale(x.rate);amount=fmt(round(base*rate,x.mode==='INSIDE'?100000000n-rate:100000000n));}
   a[key]={...x,amount,originalAmount:tax.amount,source:'Premissa confirmável do operador; imposto original preservado.'};
  }else{
   if(!dec(x.value))throw Error('Valor inválido.');
   if(['TARIFF','QUANTITY'].includes(x.kind)){const ls=u.methodology.lines.filter((l:any)=>l.component+':'+l.band===x.target);if(ls.length!==1)throw Error('Componente/posto não identificado na memória.');}
   else if(x.kind==='PERCENT'){if(x.target!=='feePercentage'||scale(x.value)>100000000n)throw Error('Percentual inválido.');}
   else if(x.kind!=='AMOUNT'||!['fixedFee','supplierPrice','supplier','invoice','extraAcr','extraAcl','creditAcr','creditAcl'].includes(x.target))throw Error('Campo não suportado.');
   if(x.kind==='AMOUNT'&&x.target!=='supplierPrice')cents(x.value);
   a[key]={...x,source:'Valor proposto pelo operador; origem e cadastros preservados.'};
  }
  if(autofillHash(before)===autofillHash(a[key]))continue;
  let previous:any=before;
  if(!before){
   if(x.kind==='AMOUNT')previous=({invoice:u.prepared.invoice.amount,supplier:u.prepared.supplier.amount,fixedFee:u.fixedFee,supplierPrice:u.fields?.find((f:any)=>f.key==='supplier:price'&&f.state==='FILLED')?.value,extraAcr:'0',extraAcl:'0',creditAcr:'0',creditAcl:'0'} as any)[x.target];
   if(x.kind==='TAX')previous={value:(x.scenario==='ACR'&&u.methodology.acrTaxes?u.methodology.acrTaxes:u.methodology.taxes).find((t:any)=>t.code===({ICMS:'icmsAmount',PIS:'pisAmount',COFINS:'cofinsAmount'} as any)[x.target]).amount,mode:'PRESERVED_INVOICE_AMOUNT'};
   if(x.kind==='PERCENT')previous=u.feePercentage??'0';
   if(x.kind==='TARIFF'||x.kind==='QUANTITY'){const l=u.methodology.lines.find((l:any)=>l.component+':'+l.band===x.target);previous=x.kind==='TARIFF'?l.value:l.quantity;}
   if(previous!==undefined&&typeof previous==='string'&&dec(previous)&&x.value!==undefined&&dec(x.value)&&scale(previous)===scale(x.value)){delete a[key];continue;}
  }
  diff.push({unitId:x.unitId,field:key,before:previous,after:a[key]});
 }
 if(!diff.length)throw Error('Nenhuma alteração efetiva; não há desconto de documento.');
 for(const u of report.units){
  const a=u.adjustments??{},get=(k:string)=>a[k]?.value;
  let acr=0n;for(const l of u.methodology.lines){const k=l.component+':'+l.band,q=get('QUANTITY:'+k+':')??l.quantity,v=get('TARIFF:'+k+':')??l.value;acr+=cents(u.methodology.method==='COMPONENT_TAXES_V3'?repriceComponentGross(l,q,get('TARIFF:'+k+':')):documentedLineAmount(l,q,get('TARIFF:'+k+':')));}
  acr+=u.methodology.retained.reduce((s:bigint,r:any)=>s+cents(r.amount),0n);
  // Existing non-invoice costs remain part of the original complete report.
  acr+=cents(u.changeBase?.acr??u.acr)-cents(u.methodology.amount);
  let acl=cents(u.changeBase?.aclBeforeFees??u.aclBeforeFees);
  const adAcr:string[]=[],adAcl:string[]=[];
  for(const v of Object.values(a) as any[])if(v.kind==='TAX'){const delta=fmt(cents(v.amount)-cents(v.originalAmount));(v.scenario==='ACR'?adAcr:adAcl).push(delta);}
  const invoice=get('AMOUNT:invoice:');if(invoice!==undefined)adAcl.push(fmt(cents(invoice)-cents(u.prepared.invoice.amount)));
  const supplier=get('AMOUNT:supplier:'),price=get('AMOUNT:supplierPrice:');
  if(supplier!==undefined&&price!==undefined)throw Error('Informe preço ou valor do fornecedor; não combine as duas substituições.');
  if(supplier!==undefined)adAcl.push(fmt(cents(supplier)-cents(u.prepared.supplier.amount)));
  if(price!==undefined){const volume=u.fields?.find((f:any)=>f.key==='supplier:volume'&&f.state==='FILLED')?.value;if(!dec(volume))throw Error('Volume do fornecedor não demonstrado.');adAcl.push(fmt(cents(tariffProduct(volume,price).rounded)-cents(u.prepared.supplier.amount)));}
  if(get('AMOUNT:extraAcr:')!==undefined)adAcr.push(fmt(cents(get('AMOUNT:extraAcr:'))));if(get('AMOUNT:extraAcl:')!==undefined)adAcl.push(fmt(cents(get('AMOUNT:extraAcl:'))));if(get('AMOUNT:creditAcr:')!==undefined)adAcr.push(fmt(-cents(get('AMOUNT:creditAcr:'))));if(get('AMOUNT:creditAcl:')!==undefined)adAcl.push(fmt(-cents(get('AMOUNT:creditAcl:'))));
  acr+=adAcr.reduce((s,v)=>s+cents(v),0n);acl+=adAcl.reduce((s,v)=>s+cents(v),0n);
  if(acr<0n||acl<0n)throw Error('Total negativo incompatível.');u.acr=fmt(acr);u.aclBeforeFees=fmt(acl);u.fixedFee=get('AMOUNT:fixedFee:')!==undefined?fmt(cents(get('AMOUNT:fixedFee:'))):u.fixedFee;u.feePercentage=get('PERCENT:feePercentage:')??u.feePercentage;u.adjustmentTotals={acr:adAcr,acl:adAcl};
 }
 const percentages=report.units.map((u:any)=>u.feePercentage??'0');if(new Set(percentages).size!==1)throw Error('Honorário variável deve ser consistente entre as unidades.');
 const sum=(key:string):bigint=>report.units.reduce((s:bigint,u:any)=>s+cents(u[key]),0n),acr=sum('acr'),acl=sum('aclBeforeFees'),fixedFee=sum('fixedFee'),base=acr-acl,variable=base>0n?round(base*scale(percentages[0]),100000000n):0n;
 const allocations=report.units[0].fields?.find((f:any)=>f.key==='fee:allocation'&&f.state==='FILLED')?.value;
 if(variable>0n&&(!Array.isArray(allocations)||allocations.length!==report.units.length||allocations.reduce((s:bigint,a:any)=>s+scale(a.percentage),0n)!==100000000n||new Set(allocations.map((a:any)=>a.consumerUnitId)).size!==report.units.length||allocations.some((a:any)=>!report.units.some((u:any)=>u.id===a.consumerUnitId))))throw Error('Rateio integral não demonstrado.');
 const shares=variable>0n?allocateFee(fmt(variable),allocations):report.units.map((u:any)=>({consumerUnitId:u.id,amount:'0.00'}));
 for(const u of report.units){const share=cents(shares.find((a:any)=>a.consumerUnitId===u.id).amount);u.variableFee=fmt(share);u.totalFees=fmt(cents(u.fixedFee)+share);u.aclAfterFees=fmt(cents(u.aclBeforeFees)+cents(u.totalFees));u.savings=fmt(cents(u.acr)-cents(u.aclAfterFees));}
 const totalFees=fixedFee+variable,after=acl+totalFees,savings=acr-after;report.financial={status:'AVAILABLE',acr:fmt(acr),aclBeforeFees:fmt(acl),fixedFee:fmt(fixedFee),variableFee:fmt(variable),totalFees:fmt(totalFees),aclAfterFees:fmt(after),savings:fmt(savings),savingsPercent:acr>0n?fmt(round(savings*10000n,acr)):null};
 // Old comparison metrics describe an earlier candidate: retain as source, never present as newly calculated.
 for(const u of report.units){
  u.previousCandidateComparison??=u.comparison;
  const old=u.previousCandidateComparison;
  if(old){const current:Record<string,unknown>={'Honorário fixo':u.fixedFee,'Custo ACR':u.acr,'Custo ACL antes dos honorários':u.aclBeforeFees,'Honorário variável':u.variableFee,'Honorários totais':u.totalFees,'ACL com honorários':u.aclAfterFees,'Economia':u.savings,'Preço do fornecedor':u.adjustments?.['AMOUNT:supplierPrice:']?.value??u.fields?.find((f:any)=>f.key==='supplier:price'&&f.state==='FILLED')?.value};u.comparison={...old,tariffChanges:[],metrics:old.metrics?.map((m:any)=>m.label in current?historicalDifference(m.label,current[m.label],m.previous,m.basis):m)};}
 }
 report.methodology='EVA_CONFIRMED_CHANGES_V1';report.completeness='ESTIMATED';report.automaticApproval=false;report.publicationAllowed=false;report.changeProposal={question,changes,diff};report.justification='Nova versão proposta por solicitação do operador. Confira os ajustes e as bases explícitas antes da decisão.';report.observations=['Comparativo revisado: ajustes explícitos do estudo substituem somente os campos solicitados. Leituras e memórias originais permanecem preservadas; consulte o quadro de ajustes desta versão.',...report.observations.filter((n:string)=>!n.includes(' variou de ')&&!n.startsWith('Estimativa comparativa:')),...report.units.flatMap((u:any)=>(u.comparison?.metrics??[]).filter((m:any)=>m.comparable&&m.difference!==null&&Number(m.difference)!==0).map((m:any)=>u.name+': '+m.label+' variou de '+m.previous+' para '+m.current+' '+m.basis+'. Diferença observada; nenhuma causa não comprovada foi atribuída.')),'Ajustes do estudo propostos pelo operador; não alteram OCR, contratos, bibliotecas nem comprovam incidência fiscal.'];return {report,diff};
}
