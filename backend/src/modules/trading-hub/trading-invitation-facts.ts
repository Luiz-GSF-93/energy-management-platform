/** Public business facts shared by the invitation e-mail and supplier portal. Never enumerate source data. */
export function tradingInvitationFacts(d:Record<string,any>):[string,string][]{
 return [
  ['Oportunidade',String(d.title??'Cotação ACL')],
  ['Submercado',({SE_CO:'Sudeste / Centro-Oeste',S:'Sul',NE:'Nordeste',N:'Norte'} as Record<string,string>)[d.submarket]??String(d.submarket??'Não informado')],
  ['Modalidade',({CONVENTIONAL:'Convencional',INCENTIVIZED_50:'Incentivada 50%',INCENTIVIZED_100:'Incentivada 100%'} as Record<string,string>)[d.energyType]??String(d.energyType??'Não informada')],
  ['Consumo médio',Number(d.averageMwhMonth).toLocaleString('pt-BR')+' MWh/mês'],
  ['Fornecimento',d.startMonth+' · '+d.months+' meses'],
  ['Prazo para resposta',new Date(d.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)'],
 ];
}
