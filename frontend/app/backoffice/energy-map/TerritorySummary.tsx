'use client';
import {MapUnit} from './map-data';
import {PlatformMapRow} from './platform-map-data';
import {territorySummary} from './territory-data';
import styles from './map.module.css';
export default function TerritorySummary({rows,organizationId,onState}:{rows:(MapUnit|PlatformMapRow)[];organizationId?:string;onState:(state:string)=>void}){
 const {regions,omitted}=territorySummary(rows,organizationId);
 return <section className={styles.territory} aria-label="Distribuição da carteira por estado"><div><h2>Presença regional</h2><p>Unidades da página atual, conforme o endereço cadastral. Um cliente pode ter unidades em mais de um estado.</p></div>
  {regions.length?<div className={styles.regionGrid}>{regions.map(r=><button key={r.state} type="button" onClick={()=>onState(r.state)} aria-label={'Filtrar carteira por '+r.state}><strong>{r.state}</strong><span>{r.customers} clientes · {r.units} unidades</span><small>{r.confirmed} localizações conferidas</small></button>)}</div>:<p>Nenhuma unidade com estado informado nesta página.</p>}
  {omitted>0?<small>{omitted} unidades sem UF válida. Confira o cadastro.</small>:null}
 </section>;
}
