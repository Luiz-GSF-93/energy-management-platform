import type {Unit} from './types';
export type LibraryCandidate={id:string;root_id:string;version:number;profile:{distributor:string;group:string;subgroup:string;modality:string;consumptionClass:string;category:string;startDate:string;endDate:string}};
const norm=(s:unknown)=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function matchTariffLibrary<T extends LibraryCandidate>(rows:T[],unit:Unit|undefined,month:string,category=''):{candidate?:T;start?:string;end?:string;message:string}{
 if(!unit)return{message:'Selecione a unidade para buscar a referência tarifária.'};
 const missing=[!unit.distributor&&'distribuidora',!unit.tariff_group&&'grupo',!unit.tariff_subgroup&&'subgrupo',!unit.tariff_modality&&'modalidade',!unit.consumption_class&&'classe de consumo',typeof unit.free_market!=='boolean'&&'mercado ACL/ACR'].filter(Boolean);
 if(missing.length)return{message:'Complete o cadastro da unidade: '+missing.join(', ')+'.'};
 if(!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))return{message:'Informe uma competência válida.'};
 const [y,m]=month.split('-').map(Number),start=month+'-01',end=month+'-'+new Date(Date.UTC(y,m,0)).getUTCDate();
 const latest=rows.filter(r=>!rows.some(n=>n.root_id===r.root_id&&n.version>r.version));
 const matching=latest.filter(({profile:p})=>(norm(unit.distributor)===norm(p.distributor)||(norm(p.distributor)==='NEOENERGIAELEKTRO'&&norm(unit.distributor)==='ELEKTRO'))&&norm(unit.tariff_group)===norm(p.group)&&norm(unit.tariff_subgroup)===norm(p.subgroup)&&unit.tariff_modality===p.modality&&(p.consumptionClass==='GENERAL'||norm(unit.consumption_class)===norm(p.consumptionClass))&&(!category||p.category===category));
 if(!matching.length)return{message:'Nenhuma tabela compatível com distribuidora, grupo, subgrupo, modalidade, classe e categoria. Cadastre ou revise a referência na biblioteca.'};
 const covered=matching.filter(({profile:p})=>p.startDate<=start&&p.endDate>=end);
 if(!covered.length)return{message:'Nenhuma tabela cobre toda a competência '+month+'. Confira as vigências; mudanças dentro do mês exigem tratamento por período.'};
 if(covered.length!==1)return{message:'Há '+covered.length+' tabelas compatíveis. Escolha a categoria ou revise a sobreposição antes de aplicar.'};
 return{candidate:covered[0],start,end,message:'Tabela compatível localizada: v'+covered[0].version+'. Confirme os tributos e revise a prévia antes de gerar os parâmetros.'};
}
