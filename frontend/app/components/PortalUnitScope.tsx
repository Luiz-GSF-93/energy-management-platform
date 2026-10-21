'use client';
import {createContext,ReactNode,useContext,useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from './ui';
import styles from './PortalClientWorkspace.module.css';
type Unit={id:string;name:string;installation:string|null;address:string|null};
type Identity={organizationId:string;customerId:string;companyName:string;units:Unit[]};
const Scope=createContext<{unitId:string;identity:Identity|null}|null>(null);
export const usePortalUnitScope=()=>useContext(Scope);
export default function PortalUnitScope({organizationId,children}:{organizationId:string;children:ReactNode}){
 const [identity,setIdentity]=useState<Identity|null>(null),[unitId,setUnit]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const abort=new AbortController();setIdentity(null);setUnit('');setError('');apiRequest<Identity>('/api/v1/portal/workspace/presentation/identity',{signal:abort.signal,cache:'no-store'}).then(r=>{if(r.organizationId!==organizationId||!r.customerId||!Array.isArray(r.units))throw Error('Identificação do cliente não confirmada.');if(!abort.signal.aborted){setIdentity(r);if(r.units.length===1)setUnit(r.units[0].id);}}).catch(e=>{if(!abort.signal.aborted)setError(e?.status===404||e?.status===503?'Os novos indicadores aguardam a atualiza\u00e7\u00e3o do servi\u00e7o. Os recursos j\u00e1 dispon\u00edveis continuam acess\u00edveis.':'N\u00e3o foi poss\u00edvel confirmar a empresa e as unidades. Atualize ou solicite atendimento.');});return()=>abort.abort();},[organizationId,attempt]);
 const selected=identity?.units.find(u=>u.id===unitId);
 return <Scope.Provider value={{unitId,identity}}><section className={styles.panel} aria-label="Empresa e unidade de medição"><h2>{identity?.companyName??'Empresa e unidade de medição'}</h2>{error?<Alert>{error} <Button variant="secondary" onClick={()=>setAttempt(v=>v+1)}>Atualizar identificação</Button></Alert>:!identity?<p role="status">Conferindo unidades autorizadas…</p>:<>{identity.units.length>1?<label>Visualização das unidades<select className={styles.unitSelect} value={unitId} onChange={e=>setUnit(e.target.value)}><option value="">Consolidar unidades autorizadas</option>{identity.units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>:null}{selected?<dl className={styles.unitDetails}><div><dt>Unidade de medição</dt><dd>{selected.name}</dd></div><div><dt>UC / instalação cadastrada</dt><dd>{selected.installation||'Não informada'}</dd></div><div><dt>Endereço</dt><dd>{selected.address||'Não informado'}</dd></div></dl>:<p>{identity.units.length} unidades autorizadas · visão consolidada do consumo e da demanda. Os demais painéis identificam seus próprios recortes.</p>}</>}</section>{children}</Scope.Provider>;
}
