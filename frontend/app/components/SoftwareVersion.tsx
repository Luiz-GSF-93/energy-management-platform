/** Increment this release identifier for each production BETA delivery. */
export const SOFTWARE_VERSION='0.1.0-beta.20261112.4';

export default function SoftwareVersion(){
 return <footer aria-label="Versão do EnergyOS" style={{padding:'12px 24px',textAlign:'center',fontSize:12,color:'#94a3b8',background:'#071a2b'}}>EnergyOS · v{SOFTWARE_VERSION} · BETA em validação</footer>;
}
