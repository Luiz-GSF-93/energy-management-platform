'use client';
import Link from 'next/link';
import ServiceAvailabilityPanel from '../components/ServiceAvailabilityPanel';
export default function Page(){return <main style={{maxWidth:860,margin:'40px auto',padding:24}}><h1>Disponibilidade do EnergyOS</h1>
 <p>Consulte o estado dos serviços mesmo quando o acesso estiver indisponível. Esta página não apresenta dados de organizações ou documentos.</p>
 <ServiceAvailabilityPanel/><p>A estabilidade e os ajustes gerais são acompanhados pelo Owner / Administrador da Plataforma. As organizações acompanham a disponibilidade de uso.</p>
 <p><Link href="/auth/login">Voltar ao acesso</Link></p></main>;}
