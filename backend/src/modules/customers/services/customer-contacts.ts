import {BadRequestException} from '@nestjs/common';
export type CustomerContact={id:string;name:string;department:string;email:string;phone:string;active:boolean;channels:('email'|'whatsapp'|'sms')[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function customerContacts(input:unknown):CustomerContact[]{
 if(!Array.isArray(input)||input.length>50)throw new BadRequestException('Cadastre até 50 contatos por cliente.');
 const ids=new Set<string>();
 return input.map((c:any)=>{
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['id','name','department','email','phone','active','channels'].includes(k))||typeof c.id!=='string'||!uuid.test(c.id)||ids.has(c.id.toLowerCase())||typeof c.active!=='boolean'||!Array.isArray(c.channels)||c.channels.length>3||new Set(c.channels).size!==c.channels.length||c.channels.some((v:unknown)=>typeof v!=='string'||!['email','whatsapp','sms'].includes(v)))throw new BadRequestException('Contato ou canais inválidos.');
  ids.add(c.id.toLowerCase());
  for(const [key,max] of [['name',150],['department',100],['email',254],['phone',16]] as const)if(typeof c[key]!=='string'||c[key].trim().length>max||/[\u0000-\u001f\u007f]/.test(c[key]))throw new BadRequestException('Dados do contato inválidos.');
  const name=c.name.trim(),department=c.department.trim(),email=c.email.trim(),phone=c.phone.trim();
  if(!name||(!email&&!phone)||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||phone&&!/^\+[1-9][0-9]{7,14}$/.test(phone)||c.channels.includes('email')&&!email||c.channels.some((v:string)=>v==='whatsapp'||v==='sms')&&!phone)throw new BadRequestException('Informe nome, e-mail válido e telefone internacional para os canais selecionados.');
  return {id:c.id.toLowerCase(),name,department,email,phone,active:c.active,channels:[...c.channels].sort()};
 });
}
