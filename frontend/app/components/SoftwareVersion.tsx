import packageInfo from '../../package.json';
/** Keep the detailed build internally and show the requested public version. */
export const SOFTWARE_VERSION=packageInfo.version;

export default function SoftwareVersion(){
 return <footer aria-label="Versão do EnergyOS" style={{padding:'12px 24px',textAlign:'center',fontSize:12,color:'#94a3b8',background:'#071a2b'}}>EnergyOS · v{SOFTWARE_VERSION.split('-')[0]} · BETA em validação</footer>;
}
