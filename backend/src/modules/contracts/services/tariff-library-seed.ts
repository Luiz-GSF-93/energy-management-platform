import {LibraryWriteDto} from '../dto/tariff-library.dto';
// Transcription of user-supplied PDF, pages 5-6. No inferred tax rates.
export const elektroTariffSeed:LibraryWriteDto={
 distributor:'Neoenergia Elektro',group:'A',subgroup:'A4',modality:'GREEN',category:'Geral',consumptionClass:'GENERAL',
 startDate:'2026-08-27',endDate:'2027-08-26',
 source:'PDF fornecido: 01.NEOENERGIA ELEKTRO_TARIFAS DE ENERGIA ELÉTRICA_ AGO2026_REH Nº 3605_GRUPO A.pdf. Páginas 5–6; identificação e vigência conforme documento.',
 notes:'Primeiro enquadramento: A4 Verde geral. A fonte não distingue classe industrial/comercial neste bloco. Demanda geral desdobrada em utilizada/não utilizada para usar as quantidades já registradas; incidência tributária deve ser confirmada. Reativo tem tarifa única na fonte, aplicável aos postos selecionados. Demanda reativa excedente, ultrapassagem, APE, SCEE, rural irrigante e geração exigem registros/regras específicos; não estão incluídos neste enquadramento.',
 reason:'Cadastro inicial solicitado pelo administrador a partir do documento tarifário fornecido.',
 items:[
 {component:'TUSD_ENERGY',band:'PEAK',measure:'BRL_KWH',value:'1.707280',label:'TUSD energia — ponta'},
 {component:'TUSD_ENERGY',band:'OFF_PEAK',measure:'BRL_KWH',value:'0.171900',label:'TUSD energia — fora ponta'},
 {component:'TE',band:'PEAK',measure:'BRL_KWH',value:'0.496660',label:'TE — ponta'},
 {component:'TE',band:'OFF_PEAK',measure:'BRL_KWH',value:'0.310680',label:'TE — fora ponta'},
 {component:'TUSD_DEMAND_USED',band:'ALL',measure:'BRL_KW',value:'25.200000',label:'TUSD demanda utilizada'},
 {component:'TUSD_DEMAND_UNUSED',band:'ALL',measure:'BRL_KW',value:'25.200000',label:'TUSD demanda não utilizada'},
 {component:'REACTIVE',band:'PEAK',measure:'BRL_KWH',value:'0.326360',label:'Reativo — ponta'},
 {component:'REACTIVE',band:'OFF_PEAK',measure:'BRL_KWH',value:'0.326360',label:'Reativo — fora ponta'},
 ]
};
