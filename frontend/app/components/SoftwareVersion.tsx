import {version} from '../../package.json';
/** Keep the visible BETA identifier aligned with the published package. */
export const SOFTWARE_VERSION=version;

export default function SoftwareVersion(){
 return <footer aria-label="Versão do EnergyOS" style={{padding:'12px 24px',textAlign:'center',fontSize:12,color:'#94a3b8',background:'#071a2b'}}>EnergyOS · v{SOFTWARE_VERSION} · BETA em validação</footer>;
}
