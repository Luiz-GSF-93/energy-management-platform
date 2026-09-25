import 'reflect-metadata';
import {plainToInstance} from 'class-transformer';
import {validateSync,ValidationError} from 'class-validator';
import {CreateConsumerUnitDto} from '../../consumer-units/dto/create-consumer-unit.dto';
import {CreateContractDto} from '../dto/create-contract.dto';
import {ManagementDto,ServiceAgreementDto} from '../dto/configurations.dto';
export const entryTables:Record<string,string>={distributor:'consumer_units',supply:'energy_contracts',management:'management_contracts',services:'service_agreements'};
export function entryPayload(kind:string,customer:string,payload:Record<string,unknown>){
 const p={...payload};delete p.customerId;delete p.status;
 if(kind==='supply'){p.status='DRAFT';}else p.customerId=customer;
 return p;
}
export function entryIssues(kind:string,p:Record<string,unknown>):string[]{
 const dto:any={distributor:CreateConsumerUnitDto,supply:CreateContractDto,management:ManagementDto,services:ServiceAgreementDto}[kind];
 if(!dto)return ['kind'];
 const flatten=(es:ValidationError[],prefix=''):string[]=>es.flatMap(e=>[...(e.constraints?[prefix+e.property]:[]),...flatten(e.children||[],prefix+e.property+'.')]);
 const issues=flatten(validateSync(plainToInstance(dto,p),{whitelist:true,forbidNonWhitelisted:true,forbidUnknownValues:true}));
 if(p.startDate&&p.endDate&&String(p.endDate)<String(p.startDate))issues.push('endDate');
 if(kind==='distributor'){
  if(!['A','B'].includes(String(p.tariffGroup)))issues.push('tariffGroup');
  if(!p.tariffSubgroup||!String(p.tariffSubgroup).startsWith(String(p.tariffGroup)))issues.push('tariffSubgroup');
  if(!(p.tariffGroup==='A'?['BLUE','GREEN']:['WHITE','CONVENTIONAL']).includes(String(p.tariffModality)))issues.push('tariffModality');
  if(p.tariffModality==='BLUE')for(const k of ['contractedDemandPeak','contractedDemandOffPeak'])if(p[k]==null)issues.push(k);
 }
 if(kind==='management'&&p.remunerationModel==='FIXED'&&p.savingsPercentage!==0)issues.push('savingsPercentage');
 if(kind==='services'&&p.billingBasis!=='CUSTOM'&&p.agreedValue==null)issues.push('agreedValue');
 if(kind==='supply'){
  if(!['ENERGY_PURCHASE','ENERGY_SALE'].includes(String(p.contractType)))issues.push('contractType');
  if((p.flexibilityMinPercent==null)!==(p.flexibilityMaxPercent==null)||Number(p.flexibilityMinPercent)>Number(p.flexibilityMaxPercent))issues.push('flexibilityMinPercent');
  if(['RULE','BOTH'].includes(String(p.seasonalityMode))&&!String(p.seasonalityRule||'').trim())issues.push('seasonalityRule');
  if(['MONTHLY','BOTH'].includes(String(p.seasonalityMode))&&(!Array.isArray(p.seasonalVolumes)||!p.seasonalVolumes.length))issues.push('seasonalVolumes');
  if(['INDEXED','MIXED'].includes(String(p.pricingMode)))for(const k of ['adjustmentIndex','adjustmentDate','adjustmentRule'])if(!p[k])issues.push(k);
  
  if(p.guaranteeType==='OTHER'&&!String(p.guaranteeDescription||'').trim())issues.push('guaranteeDescription');
  const start=String(p.startDate||''),end=String(p.endDate||'');
  if(Array.isArray(p.annualPrices)&&p.annualPrices.length){let next=start;for(const row of p.annualPrices){if(!row||row.startDate!==next||row.endDate<row.startDate||row.endDate>end||typeof row.pricePerMwh!=='number'||!Number.isFinite(row.pricePerMwh)||row.pricePerMwh<0){issues.push('annualPrices');break;}const date=new Date(row.endDate+'T00:00:00Z');if(!Number.isFinite(date.getTime())){issues.push('annualPrices');break;}date.setUTCDate(date.getUTCDate()+1);next=date.toISOString().slice(0,10);}if(p.annualPrices[p.annualPrices.length-1]?.endDate!==end)issues.push('annualPrices');}
  if(['MONTHLY','BOTH'].includes(String(p.seasonalityMode))&&Array.isArray(p.seasonalVolumes)&&p.seasonalVolumes.length){const first=Number(start.slice(0,4)),last=Number(end.slice(0,4)),seen=new Set<number>();if(p.seasonalVolumes.length!==last-first+1)issues.push('seasonalVolumes');for(const row of p.seasonalVolumes){if(!row||seen.has(row.year)||row.year<first||row.year>last||!Array.isArray(row.monthlyPercentages)||row.monthlyPercentages.length!==12||Math.abs(row.monthlyPercentages.reduce((a:number,b:number)=>a+b,0)-100)>0.0001||row.monthlyPercentages.some((v:number,i:number)=>v<0||v>100||(v!==0&&((row.year===first&&i+1<Number(start.slice(5,7)))||(row.year===last&&i+1>Number(end.slice(5,7))))))){issues.push('seasonalVolumes');break;}seen.add(row.year);}}
  if(p.guaranteeType)for(const k of ['guaranteeAmount','guaranteeInstitution'])if(p[k]==null||p[k]==='')issues.push(k);
 }
 return [...new Set(issues)];
}
