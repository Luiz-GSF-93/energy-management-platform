import {assessProject} from './evaluation.mjs';
export function formulaModelRows(data){
 const p=data.project,a=assessProject(data),economy=a.economy,rate=(p.economics?.discount_rate??0)/100,rows=[
  ['EnergyOS PEE — modelo de cálculo','Valor','Unidade / origem'],
  ['Organização',data.organization?.name??data.workspace,'Cadastro privado do workspace'],
  ['Beneficiário',data.company?.name,'Cadastro do projeto'],['Unidade / UC',data.unit?.name+' / '+data.unit?.uc,'Cadastro da unidade'],
  ['Versão do projeto',p.version,'Snapshot '+data.snapshot_hash],
  ['CEE',p.economics?.energy_cost??0,'R$/MWh — custo evitado regulatório'],
  ['CED',p.economics?.demand_cost??0,'R$/kW.ano — custo evitado regulatório'],
  ['Taxa anual',rate,'Fração; 0,08 = 8%'],['Economia das medidas selecionadas',economy?.energy_mwh??0,'MWh/ano; hipóteses das simulações'],
  ['Demanda coincidente comprovada',economy?.demand_kw??0,'kW — não é demanda contratada'],
  ['Benefício anual',{formula:'B6*B9+B7*B10',value:economy?.annual_benefit??0},'R$/ano'],
  ['Natureza do arquivo','MODELO — conferir na planilha oficial do edital','Não constitui aprovação ou protocolo'],
  ['Observação','Valores editáveis; a alteração no Excel não altera o cadastro da plataforma.','Recalcular e revisar o arquivo oficial CPFL.'],
  ['Recurso','Investimento total R$','Parcela PEE R$','Vida útil anos','O&M total R$/ano','O&M PEE R$/ano','FRC','Custo anual total R$','Custo anual PEE R$']
 ];
 let total=0,pee=0;
 for(const r of p.resources??[]){const i=rows.length+1,n=r.life,frc=rate===0?1/n:rate/(1-(1+rate)**-n),ca=r.total_cents/100*frc+(r.annual_om_cents??0)/100,cp=r.pee_cents/100*frc+(r.annual_om_pee_cents??0)/100;total+=ca;pee+=cp;rows.push([r.name,r.total_cents/100,r.pee_cents/100,n,(r.annual_om_cents??0)/100,(r.annual_om_pee_cents??0)/100,{formula:`IF($B$8=0,1/D${i},$B$8/(1-(1+$B$8)^(-D${i})))`,value:frc},{formula:`B${i}*G${i}+E${i}`,value:ca},{formula:`C${i}*G${i}+F${i}`,value:cp}]);}
 const last=rows.length,totalRow=last+1;
 rows.push(['Totais anualizados',null,null,null,null,null,null,{formula:last>=15?`SUM(H15:H${last})`:'0',value:total},{formula:last>=15?`SUM(I15:I${last})`:'0',value:pee}]);
 rows.push(['RCB total',{formula:`IF($B$11>0,H${totalRow}/$B$11,"")`,value:economy?.annual_benefit>0?total/economy.annual_benefit:''},'Adimensional']);
 rows.push(['RCB parcela PEE',{formula:`IF($B$11>0,I${totalRow}/$B$11,"")`,value:economy?.annual_benefit>0?pee/economy.annual_benefit:''},'Aplicar somente com fontes conciliadas e limite do edital correto']);
 rows.push(['Controle','by EnergyOS PEE · v'+p.version,data.snapshot_hash]);
 return rows;
}
