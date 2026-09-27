export default function ParameterEvidence({notes}:{notes:string}){
 const marker=' Conferências ',index=notes.indexOf(marker);
 if(!notes.startsWith('Rascunho OCR.')||index<0)return <p>{notes}</p>;
 try{const refs=JSON.parse(notes.slice(index+marker.length));if(!refs||!Array.isArray(refs.identity)||!Array.isArray(refs.consumption))return <p>{notes}</p>;
 return <><p>{notes.slice(0,index).replace(/ Prévia [a-f0-9]{64}[.]/,'')}</p><p>Evidência vinculada: {refs.identity.length} conferências de identidade e {refs.consumption.length} de consumo.</p><details><summary>Rastreabilidade técnica da integração</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{notes.slice(0,index).match(/Prévia [a-f0-9]{64}/)?.[0]}{'\n'}{JSON.stringify(refs,null,2)}</pre></details></>;
 }catch{return <p>{notes}</p>;}
}
