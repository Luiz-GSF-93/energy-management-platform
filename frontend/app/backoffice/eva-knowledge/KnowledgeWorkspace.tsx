'use client';
import {useState} from 'react';
import {Button} from '@/app/components/ui';
import GuidePublications from './GuidePublications';
import OfficialSources from './OfficialSources';
import OfficialDocuments from './OfficialDocuments';
import OfficialExtractions from './OfficialExtractions';
import SearchReleases from './SearchReleases';
export default function KnowledgeWorkspace(){
 const [section,setSection]=useState<'guides'|'sources'|'documents'|'extractions'|'search'>('guides');
 const [documentId,setDocumentId]=useState<string|null>(null);
 return <><nav aria-label="Áreas do conhecimento EVA" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:20}}><Button variant={section==='guides'?'primary':'secondary'} aria-pressed={section==='guides'} onClick={()=>setSection('guides')}>Guias do EnergyOS</Button><Button variant={section==='sources'?'primary':'secondary'} aria-pressed={section==='sources'} onClick={()=>setSection('sources')}>Fontes oficiais</Button><Button variant={section==='documents'?'primary':'secondary'} aria-pressed={section==='documents'} onClick={()=>setSection('documents')}>Documentos originais</Button><Button variant={section==='extractions'?'primary':'secondary'} aria-pressed={section==='extractions'} onClick={()=>{setDocumentId(null);setSection('extractions')}}>Extração e curadoria</Button><Button variant={section==='search'?'primary':'secondary'} aria-pressed={section==='search'} onClick={()=>setSection('search')}>Indexação e busca</Button></nav>{section==='guides'?<GuidePublications/>:section==='sources'?<OfficialSources/>:section==='documents'?<OfficialDocuments onExtract={id=>{setDocumentId(id);setSection('extractions')}}/>:section==='search'?<SearchReleases/>:<OfficialExtractions initialDocumentId={documentId}/>}</>;
}
