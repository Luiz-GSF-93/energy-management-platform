'use client';
import {useAuth} from '@/app/providers';
import BotEnergyHelp from './BotEnergyHelp';
export default function BotEnergyBackoffice(){
 const {status,context,hasPermission}=useAuth();
 if(status!=='authenticated'||!context||context.scope==='global'||(!['operacional','gestor','admin_org'].includes(context.currentOrganization.role)&&context.accessMode!=='platform_operation')||!hasPermission('8f105b02-4443-49de-b188-847e0284e7ed')||!hasPermission('60f9690a-145b-4dba-b23f-9f945baca296'))return null;
 return <aside aria-label="bot-energy no backoffice" style={{position:'fixed',right:16,bottom:16,zIndex:20,maxWidth:'calc(100vw - 32px)',maxHeight:'70vh',overflowY:'auto'}}><BotEnergyHelp compact key={context.currentOrganization.id+':'+context.user.id+':'+context.currentOrganization.role+':'+context.accessMode+':'+context.currentOrganization.permissions.join(',')}/></aside>;
}
