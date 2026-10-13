'use client';
import {useState} from 'react';
import {Button} from '@/app/components/ui';
import GuidePublications from './GuidePublications';
import OfficialSources from './OfficialSources';
import OfficialDocuments from './OfficialDocuments';
export default function KnowledgeWorkspace(){
 const [section,setSection]=useState<'guides'|'sources'|'documents'>('guides');
 return <><nav aria-label="Áreas do conhecimento EVA" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:20}}><Button variant={section==='guides'?'primary':'secondary'} aria-pressed={section==='guides'} onClick={()=>setSection('guides')}>Guias do EnergyOS</Button><Button variant={section==='sources'?'primary':'secondary'} aria-pressed={section==='sources'} onClick={()=>setSection('sources')}>Fontes oficiais</Button><Button variant={section==='documents'?'primary':'secondary'} aria-pressed={section==='documents'} onClick={()=>setSection('documents')}>Documentos originais</Button></nav>{section==='guides'?<GuidePublications/>:section==='sources'?<OfficialSources/>:<OfficialDocuments/>}</>;
}
