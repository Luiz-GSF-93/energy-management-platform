import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
const text=(v:unknown)=>{if(v===undefined)return '';if(typeof v!=='string'||v.length>150)throw new BadRequestException('Filtro inválido.');return v.trim();};
const pattern=(s:string)=>'%'+Array.from(s,c=>['%','_',String.fromCharCode(92)].includes(c)?String.fromCharCode(92)+c:c).join('')+'%';
export async function searchRegistrations(db:any,org:string,kind:'customers'|'consumer_units',query:Record<string,unknown>={}){
 const fields:Record<string,string>=kind==='customers'?{document:'document',economicGroup:'economic_group',status:'status'}:{customerId:'customer_id',code:'consumer_unit_number',distributor:'distributor',city:'city',state:'state',tariffGroup:'tariff_group'};
 if(Object.keys(query).some(k=>!['q','page','size','sort',...Object.keys(fields)].includes(k)))throw new BadRequestException('Filtro desconhecido.');
 const pageText=text(query.page)||'1',sizeText=text(query.size)||'10',sort=text(query.sort)||'asc';
 if(!/^[1-9][0-9]{0,5}$/.test(pageText)||!['10','20','50'].includes(sizeText)||!['asc','desc'].includes(sort))throw new BadRequestException('Paginação inválida.');
 const page=Number(pageText),size=Number(sizeText);
 let request=db.from(kind).select('*',{count:'exact'}).eq('organization_id',org);
 const q=text(query.q);
 if(q){const safe=q.replace(/[^\p{L}\p{N}\s@./-]/gu,' ').trim();if(!safe)throw new BadRequestException('Informe um nome para pesquisar.');if(kind==='customers')request=request.or('company_name.ilike.*'+safe+'*,trade_name.ilike.*'+safe+'*');else request=request.ilike('name',pattern(safe));}
 for(const [key,column] of Object.entries(fields)){const value=text(query[key]);if(!value)continue;
  if(key==='status'){if(!['ACTIVE','INACTIVE'].includes(value))throw new BadRequestException('Situação inválida.');request=request.eq(column,value);}
  else if(key==='customerId'){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('Cliente inválido.');request=request.eq(column,value);}
  else if(key==='document'){
   const clean=value.replace(/[^a-zA-Z0-9]/g,'');if(!clean)throw new BadRequestException('CPF/CNPJ inválido para pesquisa.');
   const variants=[clean];if(clean.length===14)variants.push(clean.slice(0,2)+'.'+clean.slice(2,5)+'.'+clean.slice(5,8)+'/'+clean.slice(8,12)+'-'+clean.slice(12));if(clean.length===11)variants.push(clean.slice(0,3)+'.'+clean.slice(3,6)+'.'+clean.slice(6,9)+'-'+clean.slice(9));
   request=request.or(variants.map(v=>'document.ilike.*'+v+'*').join(','));
  }
  else request=request.ilike(column,pattern(value));
 }
 const {data,error,count}=await request.order(kind==='customers'?'company_name':'name',{ascending:sort==='asc'}).order('id',{ascending:true}).range((page-1)*size,page*size-1);
 if(error||!Array.isArray(data)||typeof count!=='number')throw new ServiceUnavailableException('Não foi possível consultar os cadastros. Tente novamente.');
 return {items:data,total:count,page,size};
}
