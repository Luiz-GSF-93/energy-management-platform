'use client';
import {useEffect,useRef,useState} from 'react';
import mapboxgl,{GeoJSONSource} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {PlatformMapRow as MapUnit,platformMapGeoJson as mapGeoJson,platformLocated as located} from './platform-map-data';
import styles from './map.module.css';

export default function PlatformMapCanvas({rows,selected,onSelect}:{rows:MapUnit[];selected:MapUnit|null;onSelect:(id:string)=>void}) {
 const container=useRef<HTMLDivElement>(null),map=useRef<mapboxgl.Map|null>(null),latest=useRef({rows,onSelect});
 latest.current={rows,onSelect};
 const [error,setError]=useState(''),[ready,setReady]=useState(false);
 const token=process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
 useEffect(()=>{
  if(!token?.startsWith('pk.')||!container.current)return;
  if(!mapboxgl.supported()){setError('Seu navegador não oferece suporte ao mapa. Use a lista de unidades abaixo.');return;}
  let alive=true,m:mapboxgl.Map;
  try {
   m=new mapboxgl.Map({container:container.current,accessToken:token,style:'mapbox://styles/mapbox/light-v11',center:[-51,-15],zoom:3.2,attributionControl:true,cooperativeGestures:true});
   map.current=m;m.addControl(new mapboxgl.NavigationControl(),'top-right');
   m.on('error',event=>{if(!alive)return;const status=(event.error as Error & {status?:number}).status;setError(status===403?'Mapbox recusou este domínio ou as permissões do token (403). Confira a configuração do token.':status===401?'Token público do mapa inválido (401). Confira a configuração.':'Mapa base indisponível. A lista continua disponível; tente recarregar o mapa.');});
   m.on('load',()=>{
    if(!alive)return;
    m.addSource('units',{type:'geojson',data:mapGeoJson(latest.current.rows),cluster:true,clusterMaxZoom:14,clusterRadius:45});
    m.addLayer({id:'clusters',type:'circle',source:'units',filter:['has','point_count'],paint:{'circle-color':'#0b625c','circle-radius':['step',['get','point_count'],20,20,27,100,34],'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    m.addLayer({id:'counts',type:'symbol',source:'units',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['DIN Offc Pro Medium','Arial Unicode MS Bold'],'text-size':13},paint:{'text-color':'#fff'}});
    m.addLayer({id:'points',type:'circle',source:'units',filter:['!', ['has','point_count']],paint:{'circle-color':['match',['get','market'],'ACL','#2563eb','ACR','#0d9488','#64748b'],'circle-radius':['case',['get','approximate'],7,9],'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    m.on('click','points',e=>{const f=e.features?.[0] as unknown as {properties?:{id?:unknown}}|undefined;const id=f?.properties?.id;if(typeof id==='string')latest.current.onSelect(id);});
    m.on('click','clusters',e=>{const f=e.features?.[0] as unknown as {geometry:{type:string;coordinates:[number,number]};properties?:{cluster_id?:number}}|undefined;if(f?.geometry.type!=='Point'||typeof f.properties?.cluster_id!=='number')return;
     const center=f.geometry.coordinates;
     (m.getSource('units') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id,(err,zoom)=>{if(!err&&zoom!=null&&alive)m.easeTo({center,zoom});});
    });
    for(const layer of ['points','clusters']){m.on('mouseenter',layer,()=>{m.getCanvas().style.cursor='pointer';});m.on('mouseleave',layer,()=>{m.getCanvas().style.cursor='';});}
    setError('');setReady(true);
   });
  }catch{setError('Não foi possível iniciar o mapa. Use a lista de unidades.');}
  return()=>{alive=false;setReady(false);map.current=null;m?.remove();};
 },[token]);
 useEffect(()=>{if(ready)(map.current?.getSource('units') as GeoJSONSource|undefined)?.setData(mapGeoJson(rows));},[rows,ready]);
 useEffect(()=>{if(ready&&selected&&located(selected))map.current?.easeTo({center:[selected.longitude!,selected.latitude!],zoom:14});},[selected,ready]);
 function fit(){const points=rows.filter(located);if(!points.length){map.current?.easeTo({center:[-51,-15],zoom:3.2});return;}const bounds=new mapboxgl.LngLatBounds();points.forEach(u=>bounds.extend([u.longitude!,u.latitude!]));map.current?.fitBounds(bounds,{padding:70,maxZoom:14,duration:700});}
 return <div className={styles.mapFrame}>
  <div ref={container} className={styles.canvas} aria-label="Mapa das unidades da plataforma"/>
  {!token?.startsWith('pk.')?<div className={styles.mapNotice}><strong>Mapa base aguardando configuração</strong><p>As unidades e suas localizações continuam disponíveis na lista.</p></div>:error?<div className={styles.mapNotice} role="status">{error}</div>:null}
  <div className={styles.mapCaption}><span className={styles.liveDot}/> Localizações conferidas · página atual</div>
  <button type="button" className={styles.fit} onClick={fit} disabled={!ready}>Enquadrar unidades</button>
 </div>;
}
