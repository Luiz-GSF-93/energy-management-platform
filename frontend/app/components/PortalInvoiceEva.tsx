'use client';
import {useState} from 'react';
import BotEnergyReports from './BotEnergyReports';
import EvaSymbol from './EvaSymbol';
import DocumentDialog from '@/app/backoffice/documents/DocumentDialog';
import {Button} from './ui';
import styles from './PortalClientWorkspace.module.css';
export default function PortalInvoiceEva({enabled}:{enabled:boolean}){
 const [open,setOpen]=useState(false);
 return <><button className={styles.evaDock} aria-label="Conversar com EVA sobre minhas faturas" onClick={()=>setOpen(true)}><EvaSymbol size={26}/><span>EVA · Minhas faturas</span></button>{open?<DocumentDialog label="EVA · Minhas faturas" onClose={()=>setOpen(false)}><Button variant="secondary" onClick={()=>setOpen(false)}>Fechar EVA</Button><h2>EVA · Suas faturas</h2><p>Selecione um mês para visualizar a fatura, conferir o vencimento e informar se foi paga. A declaração de pagamento não equivale à confirmação bancária. Para substituir uma fatura recebida, solicite atendimento.</p><a href="/portal#notificacoes">Solicitar atendimento</a>{enabled?<BotEnergyReports audience="client"/>:null}</DocumentDialog>:null}</>;
}
