'use client';
import type {MapUnit} from './map-data';
import type {PlatformMapRow} from './platform-map-data';
import {portfolioProfiles,profileLabel,ProfileFilters} from './profile-data';
import styles from './map.module.css';

export default function PortfolioProfiles({rows,organizationId,active,onFilter}:{rows:(MapUnit|PlatformMapRow)[];organizationId?:string;active:ProfileFilters;onFilter:(filters:ProfileFilters)=>void}){
 const profiles=portfolioProfiles(rows,organizationId);
 return <section className={styles.territory} aria-label="Perfis energéticos da carteira"><h2>Perfis energéticos</h2>
  <p>Combinações cadastradas nas unidades da página atual, conforme os filtros aplicados. Clique em um perfil para explorar a carteira.</p>
  <div className={styles.profileGrid}>{profiles.map(p=><button key={p.key} type="button" aria-label={'Filtrar perfil '+profileLabel(p.filters)} aria-pressed={active.market===p.filters.market&&active.gd===p.filters.gd&&active.bess===p.filters.bess} onClick={()=>onFilter(p.filters)}>
   <strong>{profileLabel(p.filters)}</strong><span>{p.units} {p.units===1?'unidade':'unidades'} · {p.customers} {p.customers===1?'cliente':'clientes'}</span>
  </button>)}</div>
  {!profiles.length?<p>Nenhuma unidade nesta página para compor os perfis.</p>:null}
  <p>Uma unidade pertence a um perfil; um cliente pode ter unidades em vários perfis. GD e BESS não informados permanecem pendentes de classificação.</p>
  {active.market||active.gd||active.bess?<div className={styles.layerControls}><button type="button" onClick={()=>onFilter({market:'',gd:'',bess:''})}>Limpar filtros de perfil</button></div>:null}
 </section>;
}
