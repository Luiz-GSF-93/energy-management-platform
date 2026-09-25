import {MonthlyCostsPayloadDto} from '../dto/monthly-costs.dto';
export function normalizeCosts(c:MonthlyCostsPayloadDto){return {noCosts:c.noCosts,items:c.items.map(i=>({...i,label:i.label.trim(),source:i.source.trim()}))};}
export function costIssues(c:MonthlyCostsPayloadDto,validating=false){const issues:string[]=[];
 if(new Set(c.items.map(i=>i.id)).size!==c.items.length)issues.push('Cada lançamento deve possuir identificador único.');
 if(c.noCosts&&c.items.length)issues.push('Remova os lançamentos ou desmarque a declaração de ausência de custos.');
 if(validating&&!c.noCosts&&!c.items.length)issues.push('Cadastre os custos/créditos ou declare a ausência após revisão.');
 if(validating&&c.items.some(i=>i.taxTreatment==='UNSPECIFIED'))issues.push('Informe o tratamento tributário de todos os lançamentos antes de validar.');
 return issues;
}
