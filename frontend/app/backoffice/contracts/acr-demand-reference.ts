type Demand={single:string|null;peak:string|null;offPeak:string|null;used?:string|null;unused?:string|null;source:string};
/** Explicit scenario choice; only the latest validated source, never an edited or draft snapshot. */
export function acrDemandFromValidated(row:any,unit:any,month:string,previousId:string|null,existing:Demand|undefined):Demand|null{
 if(existing||!row||!unit||row.id!==previousId||row.status!=='VALIDATED'||!row.validated_by||!row.validated_at||!Number.isInteger(row.revision)||row.revision<1||row.consumer_unit_id!==unit.id||row.month!==month||unit.tariff_group!=='A'||unit.tariff_modality!=='GREEN'||unit.free_market!==true)return null;
 if(!row.unit_context||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].some(k=>(row.unit_context[k]??null)!==(unit[k]??null)))return null;
 const d=row.billed_demand?.ACL,valid=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(v);
 if(!d||![d.single,d.used,d.unused].every(valid)||d.peak!=null||d.offPeak!=null||!d.source?.trim())return null;
 const scaled=(v:string)=>{const [w,f='']=v.split('.');return BigInt(w)*BigInt(1000000)+BigInt(f.padEnd(6,'0'));};
 if(scaled(d.used)+scaled(d.unused)!==scaled(d.single))return null;
 return {single:d.single,used:d.used,unused:d.unused,peak:null,offPeak:null,source:'Referência ACR nas mesmas condições de demanda ACL, confirmada pelo gestor ao salvar. Quantidades da versão '+row.version+', revisão '+row.revision+' · registro '+row.id+' · '+month+'. Tarifas e tributos ACR independentes. Origem: '+d.source.slice(0,1200)};
}
