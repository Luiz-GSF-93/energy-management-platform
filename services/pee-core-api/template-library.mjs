import {createHash} from 'node:crypto';
import {escape as e,renderReport} from './reports.mjs';
import {assessProject} from './evaluation.mjs';
import {economicFormulae} from './document-control.mjs';
import {requiredSections,ProjectError} from './project-policy.mjs';
import {brandMarkup,brandCss,embeddedFonts} from './brand.mjs';

// Public definitions contain no beneficiary data. Values are resolved only from
// the authorized project snapshot, never from a previous generation or a client payload.
export const templateVersion='EE-PEE-LIB-1.0';
export const templateCatalog=Object.freeze([
 ['presentation','Carta de apresentação','consent','presentation'],
 ['diagnosis','Diagnóstico energético','baseline','diagnosis'],
 ['memorial','Memorial descritivo','other','memorial'],
 ['mv','Plano de medição e verificação','mv_plan','mv'],
 ['economics','Memória econômica e fórmulas da RCB','other','economics'],
 ['schedule','Cronograma físico-financeiro','other','schedule'],
 ['compliance','Matriz de requisitos e evidências','other','compliance'],
 ['inventory','Inventário de equipamentos e recursos','baseline'],
 ['quotation','Proposta técnica e orçamento de referência','budgets'],
 ['electrical','Desenho conceitual elétrico','diagram'],
 ['hydraulic','Desenho conceitual hidráulico','diagram'],
 ['art','Ficha de responsabilidade técnica / ART de demonstração','art'],
 ['consent','Termo de anuência do beneficiário','consent'],
 ['disposal','Plano de descarte e destinação','other'],
 ['training','Plano de capacitação e divulgação','other'],
 ['experience','Relação de experiências e certificações','other'],
 ['risks','Registro de riscos, impedimentos e premissas','other'],
 ['checklist','Checklist documental e validações','other'],
 ['workbook','Planilha de memória e checklist','other']
].map(([id,title,category,report])=>Object.freeze({id,title,category,report:report??null,version:templateVersion,formats:id==='workbook'?['xlsx']:['pdf'],demo_only:id==='art',official_form:false})));
const n=v=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:4}).format(v):'Não informado';
const table=(heads,rows)=>'<table><tr>'+heads.map(v=>'<th>'+e(v)+'</th>').join('')+'</tr>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+e(v??'Não informado')+'</td>').join('')+'</tr>').join('')+'</table>';
const paragraph=v=>'<p>'+e(v||'Não informado — preencher no cadastro do projeto.')+'</p>';
const section=(t,v)=>'<h2>'+e(t)+'</h2>'+paragraph(v);
export function templateBinding(data,id){
 const template=templateCatalog.find(t=>t.id===id);if(!template)throw new ProjectError('Modelo não encontrado.',404);
 const {project:p,company:c={},unit:u={},organization:o={}}=data;
 const missing=[['Organização contratante da plataforma',o.name??data.workspace],['CNPJ da organização contratante',o.cnpj],['Endereço da organização contratante',o.address],['Representante da organização contratante',o.representative],['Empresa beneficiária',c.name],['CNPJ do beneficiário',c.cnpj],['Endereço da empresa',c.address],['Unidade consumidora',u.name],['Número da UC',u.uc],['Endereço da unidade',u.address],['Distribuidora',p.distributor],['Chamada pública',p.call_name],['URL oficial do edital',p.call_url]].filter(([,v])=>typeof v!=='string'||!v.trim()).map(([label])=>label);
 const demonstration=/HOMOLOGA[ÇC][ÃA]O|N[ÃA]O SUBMETER/i.test(p.name);
 const bindings={organization:{name:o.name??data.workspace,cnpj:o.cnpj,address:o.address,representative:o.representative,email:o.email},beneficiary:{name:c.name,cnpj:c.cnpj,address:c.address,representative:c.representative,email:c.email},unit:{name:u.name,uc:u.uc,address:u.address,distributor:u.distributor,annual_mwh:u.annual_mwh,peak_kw:u.peak_kw},project:{id:p.id,name:p.name,version:p.version,distributor:p.distributor,call_name:p.call_name,call_url:p.call_url}};
 return {template,bindings,missing,demonstration,status:missing.length?'minuta_incompleta':'minuta_para_revisao',source_snapshot:data.snapshot_hash,source_project_version:p.version};
}
function modelBody(data,id){
 const p=data.project,s=p.sections??{},chosen=data.simulations.filter(x=>x.project_id===p.id&&x.selected),rows=p.resources??[];
 if(id==='inventory')return table(['Medida','Fabricante / modelo','Fronteira','Economia MWh/ano','Redução na ponta kW'],chosen.map(x=>[x.name,x.maker+' / '+x.model,x.boundary,n(x.result.energy),n(x.result.demand)]))+table(['Recurso','Quantidade','Unidade','Preço unitário R$','Total R$','Fonte PEE R$','Contrapartida R$','Referência'],rows.map(x=>[x.name,n(x.quantity),x.unit,n(x.unit_cents/100),n(x.total_cents/100),n(x.pee_cents/100),n(x.own_cents/100),x.quotation]));
 if(id==='quotation')return section('Natureza do orçamento','Referência elaborada na plataforma a partir dos valores cadastrados. Não é cotação emitida pelo fabricante ou fornecedor. Em homologação, os preços são fictícios e não autorizam compra, contratação ou submissão.')+modelBody(data,'inventory')+section('Escopo técnico e exclusões',s.technical)+section('Condições, premissas e fontes',s.budget)+section('Responsável pela revisão',s.engineer);
 if(['electrical','hydraulic'].includes(id))return section('Classificação do desenho','ESQUEMA CONCEITUAL — NÃO EXECUTIVO. As ligações abaixo descrevem o fluxo funcional. Dimensionamento, proteções, intertravamentos, diâmetros e condições de instalação dependem do levantamento e do profissional habilitado.')+table(['Sequência','Origem','Destino','Verificação obrigatória'],id==='electrical'?[[1,'Ponto de alimentação da unidade','Quadro do sistema de climatização','Confirmar tensão, aterramento, capacidade de curto-circuito e disponibilidade'],[2,'Quadro do sistema de climatização','Proteção e seccionamento dedicados','Dimensionar condutores, proteção, seletividade e bloqueio'],[3,'Proteção e medição de fronteira','Chiller e auxiliares afetados','Separar kWh/kW do conjunto e sincronizar registros'],[4,'Medição elétrica e sensores','Supervisão / M&V','Registrar dados e calibração, sem presumir integração ativa']]:[[1,'Retorno de água gelada','Medição de temperatura e vazão','Confirmar arranjo, fluido e precisão dos instrumentos'],[2,'Retorno instrumentado','Chiller selecionado','Verificar vazões mínima/máxima e perdas de carga'],[3,'Saída do chiller','Circuito de distribuição / consumidores','Verificar bomba, balanceamento e setpoints'],[4,'Circuito de distribuição','Retorno de água gelada','Validar serviço térmico equivalente e fronteira de M&V']])+section('Equipamentos e fronteira',chosen.map(x=>x.maker+' / '+x.model+' — '+x.boundary).join('\n'))+section('Notas do memorial',s.technical);
 if(id==='art')return section('Identificação do documento','ART FICTÍCIA DE TESTE — NÃO REGISTRADA NO CREA — SEM VALIDADE PROFISSIONAL. Esta ficha demonstra o preenchimento; não é uma ART emitida, não comprova atribuições e não atende a exigência de ART do edital.')+section('Código de demonstração','ART-DEMO-'+p.id.slice(0,8).toUpperCase())+section('Profissional informado no projeto',s.engineer)+section('Objeto e atividades propostas',s.objective)+section('Escopo e limites','Conferir registro, atribuições e ART real do profissional habilitado antes da execução. Atividades de engenharia mecânica/HVAC exigem responsável com atribuição compatível. Não reproduzir assinatura ou selo de validação.')+section('Conferência de emissão','Não emitida / não assinada / não validada. Necessário registro oficial para uso real.');
 if(id==='consent')return section('Declaração a ser conferida e assinada',`A empresa ${data.company?.name??'não informada'}, CNPJ ${data.company?.cnpj??'não informado'}, por seu representante ${data.company?.representative||'a identificar'}, declara ter conhecimento do escopo proposto para ${data.unit?.name??'unidade não informada'}, UC ${data.unit?.uc??'não informada'}, e autoriza a análise documental para elaboração do projeto indicado nesta minuta. Esta minuta não comprova anuência enquanto não assinada pelo representante com poderes verificados.`)+section('Objeto',s.objective)+section('Premissas e responsabilidades',s.risks)+section('Assinatura','Assinar o arquivo pelos meios aceitos no edital; anexar o documento retornado e o resultado da conferência ITI. Este modelo não contém assinatura.');
 const mapping={disposal:['disposal','disposal'],training:['training','market_barriers'],experience:['experience','engineer'],risks:['risks','eligibility']};
 if(mapping[id])return mapping[id].map(k=>section(requiredSections[k],s[k])).join('');
 const a=assessProject(data);return table(['Validação','Situação'],Object.entries(requiredSections).map(([k,label])=>[label,s[k]?.trim()?'Preenchido — conferir evidências':'Não preenchido']))+table(['Documento','Categoria','Conferência da assinatura','SHA-256'],data.documents.map(d=>[d.name,d.category,d.signature_review==='verified'?'Conferido pelo fluxo de revisão':'Pendente',d.sha256]))+section('Impedimentos encontrados pelo motor',a.issues.join('\n'))+section('Critério de conclusão','Preenchimento não equivale a comprovação. O modelo não remove impedimentos, não assina documentos e não altera o estágio de submissão.');
}
export function renderTemplate(data,id){
 const binding=templateBinding(data,id),t=binding.template;
 if(t.demo_only&&!binding.demonstration)throw new ProjectError('A ART fictícia só pode ser gerada em projeto identificado como homologação — não submeter.');
 const identity=table(['Campo','Dados carregados do cadastro'],[['Organização contratante / elaboradora',binding.bindings.organization.name],['CNPJ da organização contratante',data.organization?.cnpj],['Endereço da organização contratante',data.organization?.address],['Representante da organização contratante',data.organization?.representative],['Beneficiário',data.company?.name],['CNPJ',data.company?.cnpj],['Endereço cadastral',data.company?.address],['Unidade',data.unit?.name],['UC',data.unit?.uc],['Endereço da unidade',data.unit?.address],['Distribuidora',data.project.distributor],['Chamada pública',data.project.call_name],['Fonte oficial',data.project.call_url],['Projeto / versão',data.project.id+' / '+data.project.version],['Responsável informado',data.project.sections?.engineer]]);
 // Report models use the exact same project renderer; changes in simulations,
 // resources, M&V and requirements are reflected on every new generation.
 const body=t.report?renderReport(data,t.report):modelBody(data,id);
 const content=body.replace(/<(style|header|title)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<!doctype[^>]*>|<\/?(?:body|html)[^>]*>|<meta[^>]*>/gi,'');
 const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${e(t.title)}</title><style>${embeddedFonts}${brandCss}body{font:12px/1.6 'DM Sans',Arial;color:#173c35;max-width:940px;margin:25px auto;padding:24px}header{background:#0b1117;padding:24px}h1,h2{font-family:'Space Grotesk',Arial}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{text-align:left;padding:9px;border-bottom:1px solid #d4e2dd;vertical-align:top;overflow-wrap:anywhere}th{background:#eef4e8}p{white-space:pre-wrap}.notice{background:#f3f6ec;padding:14px}@media print{button{display:none}}</style><header>${brandMarkup()}</header><h1>${e(t.title)}</h1><p class="notice">${binding.demonstration?'HOMOLOGAÇÃO — NÃO SUBMETER. ':''}MINUTA GERADA — requer conferência e assinatura quando exigida. Não substitui os formulários oficiais do edital.</p>${identity}<h2>Validação do preenchimento</h2>${paragraph(binding.missing.length?'Campos a completar: '+binding.missing.join('; '):'Campos de identificação carregados. Conferir poderes de representação, consistência cadastral e evidências.')}<h2>Conteúdo do modelo</h2>${content}<h2>Glossário e transparência</h2>${paragraph('PEE: Programa de Eficiência Energética; CPP: Chamada Pública de Projetos; RCB: Relação Custo-Benefício; M&V: Medição e Verificação. Documento preparado pela plataforma EnergyOS PEE. Valores estimados permanecem sujeitos à revisão do edital e às comprovações técnicas.')}<h2>Fórmulas de referência</h2>${table(['Indicador','Fórmula','Premissas'],economicFormulae)}<h2>Controle do modelo</h2>${paragraph(t.version+' / '+t.id+' · versão do projeto '+data.project.version+' · snapshot '+data.snapshot_hash)}<footer>by EnergyOS PEE · ${e(t.version)} · ${e(t.id)} · v${e(data.project.version)}</footer></html>`;
 const modelHash=createHash('sha256').update(templateVersion+'\n'+id+'\n'+data.snapshot_hash+'\n'+html).digest('hex');
 return {...binding,html,model_hash:modelHash,reference:'MODELO-'+id+'-'+modelHash.slice(0,12).toUpperCase()};
}
