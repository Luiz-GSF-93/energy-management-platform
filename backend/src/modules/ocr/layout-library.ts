/** Versions describe implemented parsers, never an assertion of universal OCR accuracy. */
export const invoiceLayoutLibrary = [
 {id:'cpfl-paulista-a',name:'CPFL Paulista · Grupo A',version:'1.2.0',status:'SAMPLE_VALIDATED',scope:'Fluxo validado na amostra Grupo A4 Verde ACL: identidade, operações, medições, integração, tarifas e composição comparativa. Cada nova fatura permanece sujeita às verificações e aprovações.',pending:['Ampliar amostras de competências e condições diferentes','Validar separadamente GD, outras modalidades e Grupo B','Comprovação definitiva CCEE e tributária permanece independente da validação do layout']},
 {id:'neoenergia-a4',name:'Neoenergia · A4',version:null,status:'PLANNED',scope:'Próximo layout; distribuidora e modelo a identificar na amostra',pending:['Faturas de teste e identificação da distribuidora']},
 {id:'cemig',name:'Cemig',version:null,status:'PLANNED',scope:'Após Neoenergia A4',pending:['Faturas de teste e enquadramento tarifário']},
 {id:'group-b',name:'Grupo B · por distribuidora',version:null,status:'PLANNED',scope:'Homologação separada por distribuidora, inclusive GD',pending:['Amostras com e sem compensação de energia']},
] as const;
