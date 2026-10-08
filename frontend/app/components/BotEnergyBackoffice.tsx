'use client';
import {useAuth} from '@/app/providers';
import BotEnergyHelp from './BotEnergyHelp';
import BotEnergyAgenda from './BotEnergyAgenda';
export default function BotEnergyBackoffice(){
 const {status,context,hasPermission}=useAuth();
 if(status!=='authenticated'||!context||context.scope==='global'||(!['operacional','gestor','admin_org'].includes(context.currentOrganization.role)&&context.accessMode!=='platform_operation'))return null;
 const canHelp=hasPermission('8f105b02-4443-49de-b188-847e0284e7ed')&&hasPermission('60f9690a-145b-4dba-b23f-9f945baca296');
 const canAgenda=['cb949e2a-e01d-4cf0-8c69-6ca74fe4d627','cbb2e904-0718-4eec-9396-dba899118cdd','b142bd7b-05a3-45ee-befd-e593066c2775'].every(hasPermission);
 if(!canHelp&&!canAgenda)return null;
 const key=context.currentOrganization.id+':'+context.user.id+':'+context.currentOrganization.role+':'+context.accessMode+':'+context.currentOrganization.permissions.join(',');
 return <aside aria-label="bot-energy no backoffice" style={{position:'fixed',right:16,bottom:16,zIndex:20,maxWidth:'calc(100vw - 32px)',maxHeight:'70vh',overflowY:'auto'}}>{canAgenda&&<BotEnergyAgenda key={'agenda:'+key} organizationId={context.currentOrganization.id}/>} {canHelp&&<BotEnergyHelp compact key={key}/>}</aside>;
}
