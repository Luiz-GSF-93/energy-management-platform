export function policyFieldErrors(value:unknown,plan:{maxUnits:number;maxUsers:number}):Record<string,string>{
 const errors:Record<string,string>={};
 if(!value||typeof value!=='object'||Array.isArray(value))return {definition:'Informe as condições da política.'};
 const d=value as Record<string,any>;
 for(const key of ['minUnits','maxUnits','maxUsers','monthlyCents','annualDiscountBps'])if(!Number.isSafeInteger(d[key])||d[key]<0||d[key]>1000000000)errors[key]='Informe um valor inteiro válido na unidade da API.';
 if(!['PACKAGE','UNIT'].includes(d.basis))errors.basis='Selecione pacote ou unidade.';
 if(d.minUnits<1||d.minUnits>d.maxUnits)errors.minUnits='O mínimo deve ser pelo menos 1 e não exceder o máximo.';
 if(d.maxUnits>plan.maxUnits)errors.maxUnits='O catálogo permite até '+plan.maxUnits+' unidades.';
 if(d.maxUsers<1||d.maxUsers>plan.maxUsers)errors.maxUsers='O catálogo permite de 1 a '+plan.maxUsers+' usuários.';
 if(d.monthlyCents<1)errors.monthlyCents='Informe um preço mensal maior que zero.';
 if(d.annualDiscountBps>10000)errors.annualDiscountBps='O desconto anual deve ficar entre 0 e 100%.';
 for(const key of ['starts','ends'])if(typeof d[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d[key])||!Number.isFinite(Date.parse(d[key]))||new Date(d[key]).toISOString().slice(0,10)!==d[key])errors[key]='Informe uma data válida.';
 if(!errors.starts&&!errors.ends&&d.ends<d.starts)errors.ends='A vigência final não pode ser anterior à inicial.';
 for(const key of ['taxTerms','justification'])if(typeof d[key]!=='string'||d[key].trim().length<5||d[key].length>1000)errors[key]='Preencha de 5 a 1000 caracteres.';
 if(!Array.isArray(d.extras)||d.extras.length>20)errors.extras='Informe no máximo 20 adicionais.';
 else d.extras.forEach((x:any,i:number)=>{if(!x||typeof x!=='object'||!/^[-a-z0-9_]{1,40}$/.test(x.code??'')||typeof x.label!=='string'||x.label.trim().length<2||x.label.length>120||!Number.isSafeInteger(x.cents)||x.cents<0||x.cents>1000000000||!['MONTHLY','ONCE'].includes(x.recurrence))errors['extras.'+i]='Confira código, descrição, preço e recorrência do adicional '+(i+1)+'.';});
 return errors;
}
