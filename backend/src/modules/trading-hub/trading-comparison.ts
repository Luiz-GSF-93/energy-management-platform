import {proposalIsLive,supplyPriceRows} from './trading-supply';
export function compareTrading(opportunity:any,proposals:any[]){

 const o=opportunity.data;if(['CANCELLED','CLOSED'].includes(opportunity.status)||Date.parse(o.expiresAt)<=Date.now())return [];if(o.supplyVersion===3){const matrix=proposals.filter(p=>!['REJECTED','DECLINED','CANCELLED'].includes(p.status)&&p.data.energyType===o.energyType&&proposalIsLive(p.data)).flatMap(p=>supplyPriceRows(p.data,o).map((r:any)=>({id:p.id,supplierId:p.data.supplierId,...r,energyMonthlyBrl:null,estimatedSavingBrl:null,npvBrl:null,paybackMonths:null,estimateBasis:'Preço nominal por unidade e ano; sem base financeira individual.'})));let scope='',position=0,rank=0,previous:number|null=null;return matrix.sort((a,b)=>a.scopeKey.localeCompare(b.scopeKey)||a.priceBrlMwh-b.priceBrlMwh||a.id.localeCompare(b.id)).map(r=>{if(r.scopeKey!==scope){scope=r.scopeKey;position=0;rank=0;previous=null;}position++;if(previous!==r.priceBrlMwh)rank=position;previous=r.priceBrlMwh;return {...r,rank,lowestPrice:rank===1};});}const rows=proposals.filter(p=>!['REJECTED','DECLINED','CANCELLED'].includes(p.status)&&p.data.energyType===o.energyType&&proposalIsLive(p.data)).map(p=>{

  const energyMonthly=Number(o.averageMwhMonth)*Number(p.data.priceBrlMwh),baseline=o.acrMonthlyBrl==null||o.aclOtherMonthlyBrl==null||!o.comparisonBasis?null:Number(o.acrMonthlyBrl),saving=baseline==null?null:baseline-energyMonthly-Number(o.aclOtherMonthlyBrl);
  let npv:number|null=null,payback:number|null=null;if(saving!=null&&o.investmentBrl!=null&&o.discountAnnualPercent!=null){const r=Math.pow(1+Number(o.discountAnnualPercent)/100,1/12)-1;npv=-Number(o.investmentBrl);for(let m=1;m<=o.months;m++)npv+=saving/Math.pow(1+r,m);payback=saving>0?Number(o.investmentBrl)/saving:null;}

  return {id:p.id,supplierId:p.data.supplierId,priceBrlMwh:Number(p.data.priceBrlMwh),energyMonthlyBrl:energyMonthly,estimatedSavingBrl:saving,npvBrl:npv,paybackMonths:payback,estimateBasis:baseline==null?'Somente o custo de energia informado.':'Simulação conforme a base ACR e demais custos ACL informados: '+o.comparisonBasis};

 }).sort((a,b)=>a.priceBrlMwh-b.priceBrlMwh||a.id.localeCompare(b.id));let rank=0,previous:number|null=null;return rows.map((p,i)=>{if(p.priceBrlMwh!==previous)rank=i+1;previous=p.priceBrlMwh;return {...p,rank,lowestPrice:rank===1};});

}

