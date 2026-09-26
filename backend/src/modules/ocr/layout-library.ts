/** Versions describe implemented parsers, never an assertion of universal OCR accuracy. */
export const invoiceLayoutLibrary = [
 {id:'cpfl-paulista-a',name:'CPFL Paulista · Grupo A',version:'1.0.0',status:'IN_HOMOLOGATION',scope:'Tabela de operações, identificação, medições e blocos técnicos',pending:['Conferência independente com o PDF original','Amostras de competências e condições diferentes','Identidade, confiança e conciliação aprovadas','Importação transacional validada']},
 {id:'neoenergia-a4',name:'Neoenergia · A4',version:null,status:'PLANNED',scope:'Próximo layout; distribuidora e modelo a identificar na amostra',pending:['Faturas de teste e identificação da distribuidora']},
 {id:'cemig',name:'Cemig',version:null,status:'PLANNED',scope:'Após Neoenergia A4',pending:['Faturas de teste e enquadramento tarifário']},
 {id:'group-b',name:'Grupo B · por distribuidora',version:null,status:'PLANNED',scope:'Homologação separada por distribuidora, inclusive GD',pending:['Amostras com e sem compensação de energia']},
] as const;
