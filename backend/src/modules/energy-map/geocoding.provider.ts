import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';

export type GeocodeCandidate={latitude:number;longitude:number;precision:'ADDRESS'|'STREET'|'POSTCODE'|'CITY';label:string;providerId:string;accuracy:string};
export class GeocodeFailure extends Error {constructor(public readonly code:string){super(code);}}
const states='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function geocodeAddress(value:{address:string;city:string;state:string}){
 const address=value.address?.trim(),city=value.city?.trim(),state=value.state?.trim().toUpperCase();
 if(!address||address.length<5||address.length>180||!city||city.length>60||!states.includes(state)||/[;\x00-\x1f]/.test(address+city))throw new GeocodeFailure('ADDRESS_INCOMPLETE');
 const q=[address,city,state,'Brasil'].join(', ');
 if(q.length>256||q.split(/[\s,]+/).filter(Boolean).length>20)throw new GeocodeFailure('ADDRESS_INCOMPLETE');
 return {address,city,state,q};
}
export function geocodeCandidates(raw:any,expected:{city:string;state:string}):GeocodeCandidate[]{
 if(raw?.type!=='FeatureCollection'||!Array.isArray(raw.features)||raw.features.length>5)throw new GeocodeFailure('INVALID_RESPONSE');
 const candidates:GeocodeCandidate[]=[];
 for(const feature of raw.features){
  const p=feature?.properties,c=p?.context,coordinates=feature?.geometry?.coordinates;
  const city=c?.place?.name,state=c?.region?.region_code_full||c?.region?.region_code;
  if(feature?.geometry?.type!=='Point'||!Array.isArray(coordinates)||coordinates.length!==2||!coordinates.every((v:any)=>typeof v==='number'&&Number.isFinite(v)))continue;
  const [longitude,latitude]=coordinates;
  if(latitude< -34||latitude>6||longitude< -74||longitude> -28||c?.country?.country_code?.toLowerCase()!=='br'||typeof city!=='string'||normalize(city)!==normalize(expected.city)||typeof state!=='string'||state.replace(/^BR-/i,'').toUpperCase()!==expected.state)continue;
  const precision=({address:'ADDRESS',street:'STREET',postcode:'POSTCODE',place:'CITY'} as const)[p?.feature_type as 'address'];
  if(!precision||typeof p?.mapbox_id!=='string'||p.mapbox_id.length>200||typeof p?.full_address!=='string'||p.full_address.length>500)continue;
  const accuracy=typeof p?.coordinates?.accuracy==='string'?p.coordinates.accuracy.slice(0,40):'unknown';
  // Interpolated/approximate address results never acquire property-level precision.
  const verifiedPrecision=precision==='ADDRESS'&&!['rooftop','parcel','point'].includes(accuracy)?'STREET':precision;
  candidates.push({latitude,longitude,precision:verifiedPrecision,label:p.full_address,providerId:p.mapbox_id,accuracy});
 }
 return candidates;
}

@Injectable()
export class MapboxGeocodingProvider {
 constructor(private config:ConfigService){}
 configured(){const token=this.config.get<string>('MAPBOX_GEOCODING_TOKEN')||'';return this.config.get<string>('ENERGY_MAP_GEOCODING_PERMANENT')==='true'&&/^(pk|sk)\.[A-Za-z0-9_.-]+$/.test(token);}
 async locate(address:{address:string;city:string;state:string}):Promise<GeocodeCandidate[]>{
  if(!this.configured())throw new GeocodeFailure('NOT_CONFIGURED');
  const expected=geocodeAddress(address);
  const url=new URL('https://api.mapbox.com/search/geocode/v6/forward');
  Object.entries({q:expected.q,access_token:this.config.get<string>('MAPBOX_GEOCODING_TOKEN')!,permanent:'true',country:'br',language:'pt',autocomplete:'false',limit:'5',types:'address,street,postcode,place'}).forEach(([k,v])=>url.searchParams.set(k,v));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
  try{
   const response=await fetch(url,{signal:abort.signal,redirect:'error',headers:{Accept:'application/json'}});
   if(!response.ok)throw new GeocodeFailure(response.status===429?'RATE_LIMIT':response.status===401||response.status===403?'PROVIDER_AUTH':'PROVIDER_UNAVAILABLE');
   // Bound actual streamed bytes even when Content-Length is absent or incorrect.
   if(!response.body)throw new GeocodeFailure('INVALID_RESPONSE');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>65536){await reader.cancel();throw new GeocodeFailure('INVALID_RESPONSE');}chunks.push(r.value);}
   const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   return geocodeCandidates(raw,expected);
  }catch(e){if(e instanceof GeocodeFailure)throw e;throw new GeocodeFailure(abort.signal.aborted?'TIMEOUT':'PROVIDER_UNAVAILABLE');}
  finally{clearTimeout(timer);}
 }
}
