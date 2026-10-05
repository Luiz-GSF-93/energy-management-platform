export function compareTrading(opportunity:any,proposals:any[]){

 const o=opportunity.data;const rows=proposals.filter(p=>!['REJECTED','DECLINED'].includes(p.status)&&p.data.energyType===o.energyType&&p.data.validUntil>=new Date().toISOString().slice(0,10)).map(p=>{

  const energyMonthly=Number(o.averageMwhMonth)*Number(p.data.priceBrlMwh),baseline=o.acrMonthlyBrl==null||o.aclOtherMonthlyBrl==null||!o.comparisonBasis?null:Number(o.acrMonthlyBrl),saving=baseline==null?null:baseline-energyMonthly-Number(o.aclOtherMonthlyBrl);
  let npv:number|null=null,payback:number|null=null;if(saving!=null&&o.investmentBrl!=null&&o.discountAnnualPercent!=null){const r=Math.pow(1+Number(o.discountAnnualPercent)/100,1/12)-1;npv=-Number(o.investmentBrl);for(let m=1;m<=o.months;m++)npv+=saving/Math.pow(1+r,m);payback=saving>0?Number(o.investmentBrl)/saving:null;}

  return {id:p.id,supplierId:p.data.supplierId,priceBrlMwh:Number(p.data.priceBrlMwh),energyMonthlyBrl:energyMonthly,estimatedSavingBrl:saving,npvBrl:npv,paybackMonths:payback,estimateBasis:baseline==null?'Somente o custo de energia informado.':'Simulação conforme a base ACR e demais custos ACL informados: '+o.comparisonBasis};

 }).sort((a,b)=>a.priceBrlMwh-b.priceBrlMwh||a.id.localeCompare(b.id));let rank=0,previous:number|null=null;return rows.map((p,i)=>{if(p.priceBrlMwh!==previous)rank=i+1;previous=p.priceBrlMwh;return {...p,rank,lowestPrice:rank===1};});

}

