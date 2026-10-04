/** Versioned, extractive retrieval. Documents are evidence, never executable instructions. */
export const normalizeQuestion=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const concepts:Record<string,string[]>={
 workflow:['validar','valida','validacao','aprovar','aprova','aprovacao','publicar','publicacao','operador','gestor','administrador'],
 confidence:['confianca','ocr','100%','progresso','ausente','zero'],
 fees:['honorario','honorarios','hibrido','hibridos','rateio','fixo','variavel'],
 taxes:['icms','pis','cofins','imposto','impostos','tributo','tributos','tributaria','embutido','embutidos'],
 access:['permissao','permissoes','acesso','tenant','seguranca'],
 regulation:['regulatoria','regulatorio','regulacao','aneel','resolucao','normativa'],
 pending:['pendencia','pendencias','bloqueio','bloqueios','divergencia','divergencias','inconsistencia','inconsistencias','falta','faltando','preencher','preenchimento','preenchimentos','concluir','conclusao','resolver'],
 fields:['consumo','consumos','demanda','demandas','cnpj','endereco','medicao','medicoes','leitura','extraido','extraidos'],
 records:['contrato','contratos','vigencia','vigencias','fornecedor','distribuidora','tarifa','tarifas','custo','custos','registro','registros','arquivo','arquivos','documento','documentos','nf','nfe','nota','notas'],
};
export function retrieveTopics(question:string){
 const n=normalizeQuestion(question),words=new Set(n.match(/[a-z0-9%]+/g)??[]);
 // Do not interpret commands or return unrelated excerpts as answers to unsupported requests.
 if(/ignore|ignorar|publique|publica agora|senha|chave privada|token|outra organizacao|todos os clientes|execute|executar|apague|deletar/.test(n))return [];
 // Questions about where/how to validate records must use their current invoice state.
 if(concepts.workflow.some(w=>words.has(w))&&['custo','custos','mensal','mensais','registro','registros','parametro','parametros'].some(w=>words.has(w)))return ['pending'];
 // Completion/filling is a request for the invoice plan, even when it mentions validation.
 if(concepts.pending.some(w=>words.has(w)))return ['pending',...Object.keys(concepts).filter(k=>!['pending','workflow'].includes(k)&&concepts[k].some(w=>words.has(w))).slice(0,2)];
 return Object.entries(concepts).map(([key,terms])=>({key,score:terms.filter(w=>words.has(w)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key)).slice(0,3).map(x=>x.key);
}
export const regulatoryReferences=[
 {label:'ANEEL · Resolução Normativa 1.000/2021',reference:'Referência regulatória oficial. A incidência específica exige evidência e revisão; não é deduzida deste link.',url:'https://www2.aneel.gov.br/cedoc/ren20211000.pdf'},
 {label:'CPFL Paulista · tarifas',reference:'Fonte oficial de enquadramento e vigências; confirmar a versão aplicável à competência.',url:'https://www.cpfl.com.br/empresas/tarifas-cpfl-paulista'},
 {label:'CPFL Paulista · PIS e Cofins',reference:'Alíquotas mensais publicadas. Não substituem automaticamente os destaques da fatura nem comprovam sua base de incidência.',url:'https://www.cpfl.com.br/paulista/pis-cofins'},
];
