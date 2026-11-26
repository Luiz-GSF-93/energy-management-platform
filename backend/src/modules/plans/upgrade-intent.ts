import {BadRequestException} from '@nestjs/common';
const moduleNames:Record<string,string>={document_management:'Documentos',advanced_analytics:'Análises avançadas',report_generation:'Relatórios',free_market_management:'Gestão do Mercado Livre',client_portal:'Portal do Cliente',trading_hub:'Trading Hub',bot_energy_rag:'EVA',organization_audit:'Auditoria + OCR',ccee_data:'Dados CCEE',ccee_registrations:'Registros CCEE',acl_admissions:'Adesão ACL'};
export function upgradeIntent(input:{note:string;kind?:string;quantity?:number;module?:string}){
 const note=input.note.trim(),kind=input.kind??'plan';
 if(input.kind===undefined&&input.quantity===undefined&&input.module===undefined){if(note.length<3||note.length>2000)throw new BadRequestException('Descreva a solicitação.');return note;}
 if(!['plan','documents','module','tickets'].includes(kind)||note.length<3||note.length>1600)throw new BadRequestException('Descreva a ampliação desejada em até 1.600 caracteres.');
 if((kind==='documents'||kind==='tickets')&&(!Number.isSafeInteger(input.quantity)||Number(input.quantity)<1||Number(input.quantity)>1000000))throw new BadRequestException('Informe a quantidade adicional desejada.');
 if(kind==='module'&&!Object.prototype.hasOwnProperty.call(moduleNames,input.module??''))throw new BadRequestException('Selecione um módulo válido.');
 if(kind!=='module'&&input.module!==undefined||!['documents','tickets'].includes(kind)&&input.quantity!==undefined)throw new BadRequestException('Os campos devem corresponder à ampliação selecionada.');
 const label=kind==='documents'?`Documentos adicionais: ${input.quantity}`:kind==='tickets'?`Atendimentos adicionais: ${input.quantity}`:kind==='module'?`Módulo adicional: ${moduleNames[input.module!]}`:'Alteração de plano';
 return `${label}\n${note}\nSolicitação comercial: não autoriza cobrança nem altera os limites contratados.`;
}
