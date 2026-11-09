/** A reference for a chart is not proof of supply coverage or CCEE modelling. */
export function unitMarketReference(state:unknown,registered:string[]){
 const codes=[...new Set(registered)];
 if(codes.length)return codes.length===1&&['SE_CO','S','NE','N'].includes(codes[0])?{code:codes[0],basis:'REGISTERED_SUPPLY_SUBMARKET'}:{code:null,basis:'CONFLICTING_REGISTERED_SUBMARKETS'};
 const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
 const names:Record<string,string>={SP:'SP','SAO PAULO':'SP',RJ:'RJ','RIO DE JANEIRO':'RJ',MG:'MG','MINAS GERAIS':'MG',ES:'ES','ESPIRITO SANTO':'ES',DF:'DF','DISTRITO FEDERAL':'DF',GO:'GO',GOIAS:'GO',MT:'MT','MATO GROSSO':'MT',MS:'MS','MATO GROSSO DO SUL':'MS',PR:'PR',PARANA:'PR',SC:'SC','SANTA CATARINA':'SC',RS:'RS','RIO GRANDE DO SUL':'RS',AL:'AL',ALAGOAS:'AL',BA:'BA',BAHIA:'BA',CE:'CE',CEARA:'CE',PB:'PB',PARAIBA:'PB',PE:'PE',PERNAMBUCO:'PE',PI:'PI',PIAUI:'PI',RN:'RN','RIO GRANDE DO NORTE':'RN',SE:'SE',SERGIPE:'SE'};
 const uf=typeof state==='string'?names[normalize(state)]:null;
 const code=!uf?null:['SP','RJ','MG','ES','DF','GO','MT','MS'].includes(uf)?'SE_CO':['PR','SC','RS'].includes(uf)?'S':'NE';
 return {code,basis:code?'REGISTERED_STATE_REFERENCE':'SOURCE_PENDING',state:typeof state==='string'?state:null};
}
