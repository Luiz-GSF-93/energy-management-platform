import {driPage} from './ccee-dri.model';
const tax='11111111000111';
function page(columns:string[],cells:string[],reportId='119',frameId='469'){
 const csv=(xs:string[])=>xs.map(x=>"'"+x.replace(/'/g,"''")+"'").join(',');
 const xml=`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://xmlns.energia.org.br/MH/v2" xmlns:b="http://xmlns.energia.org.br/BM/v2" xmlns:o="http://xmlns.energia.org.br/BO/v2"><s:Header><m:messageHeader/><m:paginacao><m:numero>1</m:numero><m:totalPaginas>1</m:totalPaginas><m:quantidadeTotalItens>1</m:quantidadeTotalItens></m:paginacao></s:Header><s:Body><b:listarResultadoRelatorioResponse><b:resultados><o:resultadoRelatorio><o:cabecalho>${csv(columns)}</o:cabecalho><o:relatorio><o:id>${reportId}</o:id><o:quadros><o:quadro><o:id>${frameId}</o:id></o:quadro></o:quadros></o:relatorio><o:valores><o:valor>${csv(cells)}</o:valor></o:valores></o:resultadoRelatorio></b:resultados></b:listarResultadoRelatorioResponse></s:Body></s:Envelope>`;
 return driPage(xml,{kind:'DRI_RESULTS',month:'2026-09',eventCode:'202609006000',reportId,frameId},1,tax);
}
describe('VCA119/469 exact participant column',()=>{
 it('accepts only the reviewed alias and keeps original headings and unmapped values',()=>{const p=page(['CNPJ AGENTE','VOTOS'],[tax,'12']);expect(p.rows[0]).toMatchObject({columns:['CNPJ AGENTE','VOTOS'],cells:[tax,'12'],financialState:'UNMAPPED_REVIEW_REQUIRED'});});
 it.each([['119','470'],['8','469']])('does not extend the alias to report/frame %s/%s',(r,f)=>expect(()=>page(['CNPJ AGENTE'],[tax],r,f)).toThrow('DRI_PARTICIPANT_PROOF_REQUIRED'));
 it.each([['CNPJ AGENTE','CNPJ AGENTE'],['CNPJ AGENTE','CNPJ DO AGENTE']])('rejects duplicate or mixed fiscal identifiers',(a,b)=>expect(()=>page([a,b],[tax,tax])).toThrow('DRI_PARTICIPANT_PROOF_REQUIRED'));
 it.each(['22222222000122','x11111111000111',''])('rejects another participant or malformed CNPJ',value=>expect(()=>page(['CNPJ AGENTE'],[value])).toThrow('DRI_PARTICIPANT_MISMATCH'));
 it('rejects an approximate heading',()=>expect(()=>page(['CNPJ AGENTES'],[tax])).toThrow('DRI_PARTICIPANT_PROOF_REQUIRED'));
});
