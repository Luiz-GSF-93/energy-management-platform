import {BadRequestException} from '@nestjs/common';
import {randomUUID} from 'crypto';
import {LibraryApplyDto,LibraryProfileDto} from '../dto/tariff-library.dto';
export const itemKey=(i:{component:string;band:string})=>`${i.component}:${i.band}`;
const fail=(message:string):never=>{throw new BadRequestException(message);};
export function validateProfile(p:LibraryProfileDto){
 if(p.endDate<p.startDate)fail('Confira a vigência da biblioteca.');
 if(new Set(p.items.map(itemKey)).size!==p.items.length)fail('Há componentes duplicados no enquadramento.');
 for(const i of p.items){
  if(i.component.startsWith('TUSD_DEMAND')&&i.measure!=='BRL_KW')fail('Demanda exige R$/kW.');
  if(['TE','TUSD_ENERGY'].includes(i.component)&&!['BRL_KWH','BRL_MWH'].includes(i.measure))fail('Energia exige R$/kWh ou R$/MWh.');
  if(i.component==='REACTIVE'&&!['BRL_KWH','BRL_MWH','BRL_KVARH'].includes(i.measure))fail('Confira a unidade da energia reativa.');
 }
 return p;
}
export function libraryPlan(record:any,d:LibraryApplyDto,unit:any,today:string){
 const p=validateProfile(record.profile as LibraryProfileDto);
 if(d.endDate<d.startDate)fail('Confira o período de aplicação.');
 // Never extend the regulatory validity with an operator acknowledgement.
 if(d.startDate<p.startDate||d.endDate>p.endDate)fail('A tabela não cobre todo o período solicitado. Cadastre a vigência correspondente; não será prorrogada automaticamente.');
 if(p.endDate<today&&(!d.expiredConfirmed||!d.expiredReason.trim()))fail('Tabela vencida: confirme o uso histórico com justificativa ou cadastre uma nova versão.');
 const norm=(s:any)=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const sameDistributor=norm(unit.distributor)===norm(p.distributor)||(norm(p.distributor)==='NEOENERGIAELEKTRO'&&['ELEKTRO','NEOENERGIAELEKTRO'].includes(norm(unit.distributor)));
 if(!sameDistributor||norm(unit.tariff_group)!==norm(p.group)||norm(unit.tariff_subgroup)!==norm(p.subgroup)||unit.tariff_modality!==p.modality)fail('Distribuidora ou enquadramento diverge da unidade. Revise o cadastro ou selecione outra tabela.');
 const classKey=(value:unknown)=>{const key=norm(value);return key==='COMERCIAL'?'COMMERCIAL':key;};
 if(p.consumptionClass!=='GENERAL'&&classKey(p.consumptionClass)!==classKey(unit.consumption_class))fail('A classe da tabela diverge da unidade.');
 if(unit.free_market===true&&d.scenario!=='ACR'||unit.free_market===false&&d.scenario!=='ACL'||typeof unit.free_market!=='boolean')fail('Selecione o cenário comparativo oposto ao mercado cadastrado da unidade.');
 const selected=p.items.filter(i=>d.selected.includes(itemKey(i)));
 if(selected.length!==d.selected.length)fail('Seleção de componentes desatualizada.');
 if(d.includedTaxes&&(!d.embeddedCodes.length||d.taxes.length))fail('Declare os tributos embutidos e não acrescente alíquotas novamente.');
 if(!d.includedTaxes&&(d.embeddedCodes.length||d.taxes.length!==3||new Set(d.taxes.map(t=>t.code)).size!==3))fail('Informe ICMS, PIS e Cofins individualmente; zero precisa ser explícito.');
 if(d.scenario==='ACL'&&(!d.aclEnergyPrice||!d.aclSource.trim()))fail('Informe o preço da energia ACL e sua fonte para simular migração. A TE cativa não substitui o fornecedor.');
 if(Number(d.other)>0&&!d.otherLabel.trim())fail('Descreva o outro custo.');
 const source=`Biblioteca tarifária ${record.id} v${record.version} · ${p.source}`;
 const base={scenario:d.scenario,source,notes:`${d.reason}${p.endDate<today?' | Uso histórico confirmado: '+d.expiredReason:''}`,start_date:d.startDate,end_date:d.endDate,direction:'DEBIT',status:'DRAFT',included_taxes:'',base_rule:'',tax_basis:null,embedded_tax_codes:[] as string[]};
 const rows:any[]=selected.map(i=>({ ...base,id:randomUUID(),kind:'TARIFF',component_code:i.component,label:i.label,time_band:i.band,measure:d.scenario==='ACL'&&i.component==='TE'?'BRL_MWH':i.measure,amount_text:d.scenario==='ACL'&&i.component==='TE'?d.aclEnergyPrice:i.value,treatment:d.includedTaxes?'GROSS':'NET',embedded_tax_codes:d.includedTaxes?d.embeddedCodes:[],included_taxes:d.includedTaxes?d.embeddedCodes.join(', '):'',notes:base.notes+(d.scenario==='ACL'&&i.component==='TE'?' | Hipótese de energia ACL: '+d.aclSource:'')}));
 for(const t of d.taxes){
  if(t.included.some(k=>!d.selected.includes(k)))fail('A base tributária contém componente não selecionado.');
  const items=selected.map((i,index)=>({parameterId:rows[index].id,revision:2,operation:t.included.includes(itemKey(i))?'INCLUDE':'EXCLUDE'}));
  rows.push({...base,id:randomUUID(),kind:'TAX',component_code:t.code,label:t.code,time_band:'ALL',measure:'PERCENT',amount_text:t.rate,treatment:t.mode,
   base_rule:`EE_TAX_INCIDENCE_V1\n${JSON.stringify({tax:t.code,items:[],notes:'Base selecionada pelo operador. Cálculo independente por tributo, sem composição entre impostos. '+d.reason})}`,
   tax_basis:{version:1,interaction:'INDEPENDENT',items}});
 }
 if(d.includedTaxes)for(const code of d.embeddedCodes)rows.push({...base,id:randomUUID(),kind:'TAX',component_code:code,label:code,time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:'INCLUDED',base_rule:'Tributo já embutido conforme declaração do operador. '+d.reason,tax_basis:{version:1,items:selected.map((_,index)=>({parameterId:rows[index].id,revision:2,operation:'INCLUDE'}))}});
 const monthlyCosts:any[]=[];
 for(const [value,label] of [[d.cip,'Contribuição de iluminação pública (CIP)'],[d.other,d.otherLabel]])if(Number(value)>0)monthlyCosts.push({id:randomUUID(),label,amount:value,scenario:d.scenario,category:'OTHER',effect:'COST',taxTreatment:'INCLUDED',source:source.slice(0,1000)});
 if(monthlyCosts.length&&d.startDate.slice(0,7)!==d.endDate.slice(0,7))fail('CIP e outros custos exigem aplicação para uma única competência.');
 return {rows,monthlyCosts,profile:p,notes:['Parâmetros serão criados em rascunho; aprovar tarifas antes dos tributos.', 'CIP e outros valores finais serão registrados em Custos mensais, sem duplicar parâmetros de custo.', 'Cada tributo usa sua base selecionada e cálculo independente. Nenhum tributo é somado ao outro automaticamente.', ...(d.scenario==='ACL'?['Simulação ACL usa preço de energia informado; descontos e condições do fornecedor exigem evidência.']:[])]};
}
