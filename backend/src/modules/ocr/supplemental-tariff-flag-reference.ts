// Dated public evidence supplements the existing approved parameter lookup.
// Never extend a monthly announcement to a different month or color.
const august = Object.freeze({month:'2026-08',color:'AMARELA',rate:'0.018850',source:'https://www.gov.br/aneel/pt-br/assuntos/noticias/2026/bandeira-tarifaria-continua-amarela-em-agosto',label:'ANEEL, bandeira amarela agosto/2026: R$1,885 por 100kWh'});
export function supplementalTariffFlagReference(month:string){return month===august.month?august:null;}
