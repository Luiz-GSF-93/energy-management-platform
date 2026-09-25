export type Customer={id:string;company_name:string};
export type Unit={id:string;customer_id:string;name:string;consumer_unit_number:string;distributor:string;tariff_group:string;tariff_modality?:string;contracted_demand?:number;voltage?:string;address?:string;city?:string;state?:string};
export const money=(v:number)=>Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:6});
export const date=(v:string)=>v?.slice(0,10).split('-').reverse().join('/')||'—';
export const PERM={view:'60f9690a-145b-4dba-b23f-9f945baca296',create:'beb6ec90-8ba8-40ce-a156-aeef6cc75cce',update:'fd8a932f-87c0-4f86-8389-9f30c50e95b7'};
