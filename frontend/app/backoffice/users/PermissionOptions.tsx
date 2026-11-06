'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/app/components/ui';
import type {AccessCatalog,PermissionOption,PermissionRole} from './permission-types';

const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
type Props={catalog:AccessCatalog;roleId:string;selected?:string[]|null;disabled?:boolean;mode?:'individual'|'template';onValidityChange?:(valid:boolean)=>void};
export function permissionSelectionIssues(catalog:AccessCatalog,roleId:string,selection:string[],mode:'individual'|'template'='individual'){
 const role=catalog.roles.find(r=>r.id===roleId);
 return selection.flatMap(id=>{
  const p=catalog.permissions.find(p=>p.id===id);
  if(!p)return ['Ação sem definição no catálogo atual. Atualize as permissões antes de salvar.'];
  const can=catalog.metadataVersion===2?!!p.availability?.[roleId]?.[mode==='template'?'configurable':'assignable']:!!role?.permissions.includes(id);
  const prefix=p.module+' · '+(p.name||p.code)+': ';
  if(!can)return [prefix+(p.availability?.[roleId]?.reason||'Ação não autorizada para esta função.')];
  const missing=(p.dependencies??[]).filter(dep=>!selection.includes(dep));
  return missing.length?[prefix+'requer '+missing.map(dep=>catalog.permissions.find(p=>p.id===dep)?.name||'ação vinculada').join(', ')+'.']:[];
 });
}
export default function PermissionOptions(props:Props){
 const role=props.catalog.roles.find(r=>r.id===props.roleId);
 if(!role)return <p>Selecione uma função para visualizar as liberações.</p>;
 if(role.name==='admin_org'&&props.mode!=='template')return <fieldset disabled={props.disabled}><legend>Administrador da organização</legend><p>Este perfil possui autoridade integral sobre os módulos contratados e as permissões da organização. Para limitar o acesso, selecione outro perfil.</p>{role.permissions.map(id=><input key={id} type="hidden" name="permissionId" value={id}/>)}</fieldset>;
 return <Options key={props.roleId+JSON.stringify(props.selected??null)+(role.revision??'')+(props.mode??'individual')} {...props} role={role}/>;
}
function Options({catalog,role,selected,disabled=false,mode='individual',onValidityChange}:Props&{role:PermissionRole}){
 const modern=catalog.metadataVersion===2;
 const options=modern?catalog.permissions:catalog.permissions.filter(p=>role.permissions.includes(p.id));
 const initial=selected===undefined?(role.defaultPermissions??role.permissions):selected===null?role.permissions:selected;
 const allowed=(p:PermissionOption)=>modern?!!p.availability?.[role.id]?.[mode==='template'?'configurable':'assignable']:role.permissions.includes(p.id);
 const [checked,setChecked]=useState(()=>new Set(initial.filter(id=>options.some(p=>p.id===id)&&(selected!==undefined||allowed(options.find(p=>p.id===id)!)))));
 const [search,setSearch]=useState(''),[notice,setNotice]=useState('');
 const groups=Array.from(new Set(options.map(p=>p.module))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const visible=options.filter(p=>normalize([p.name,p.module,p.description??''].join(' ')).includes(normalize(search)));
 function change(p:PermissionOption,on:boolean){
  const next=new Set(checked);setNotice('');
  if(on){
   const visiting=new Set<string>();
   const include=(id:string):void=>{if(visiting.has(id))return;visiting.add(id);const item=options.find(q=>q.id===id);if(!item||!allowed(item))throw Error('Não é possível habilitar esta ação sem suas dependências. Confira a função e a licença.');for(const dep of item.dependencies??[])include(dep);next.add(id);};
   try{include(p.id);}catch(e){setNotice((e as Error).message);return;}
  }else{
   next.delete(p.id);let changed=true;
   while(changed){changed=false;for(const item of options)if(next.has(item.id)&&(item.dependencies??[]).some(id=>!next.has(id))){next.delete(item.id);changed=true;}}
  }
  setChecked(next);
 }
 const invalid=options.filter(p=>checked.has(p.id)&&!allowed(p));
 const issues=permissionSelectionIssues(catalog,role.id,Array.from(checked),mode),valid=issues.length===0;
 useEffect(()=>{onValidityChange?.(valid);},[valid,onValidityChange]);
 function removeUnavailable(){
  const next=new Set(checked);
  for(const p of invalid)next.delete(p.id);
  let changed=true;
  while(changed){changed=false;for(const p of options)if(next.has(p.id)&&(p.dependencies??[]).some(id=>!next.has(id))){next.delete(p.id);changed=true;}}
  const removed=checked.size-next.size;setChecked(next);
  setNotice(removed+' ação(ões) retirada(s) apenas desta seleção. Os acessos já cadastrados não foram alterados. Confira o resumo antes de salvar.');
 }
 return <fieldset disabled={disabled} style={{minWidth:0,padding:16,borderRadius:12}}>
  <legend>{mode==='template'?'Padrão de liberações da função':'Liberações deste usuário'}</legend>
  <p>O Administrador pode liberar as ações dos módulos contratados diretamente para este usuário, sem habilitá-las antes no padrão da função. Os demais usuários mantêm seus acessos.</p>
  <label style={{display:'grid',gap:6}}>Pesquisar módulo ou ação<input className="ds-input" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ex.: clientes, fornecedor, enviar, EVA"/></label>
  <p role="status">{checked.size} liberações selecionadas · {visible.length} ações no filtro.</p>
  {notice?<p role="alert">{notice}</p>:null}
  {issues.length?<section aria-label="Ações que impedem salvar" role="alert" style={{padding:12,border:'1px solid var(--color-border, #70869d)',borderRadius:8}}>
   <strong>Confira estas {issues.length} ação(ões) antes de salvar:</strong>
   <ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>
   <Button type="button" variant="secondary" onClick={removeUnavailable}>Retirar ações incompatíveis da seleção</Button>
   <p>A retirada só ajusta este formulário. A licença e as permissões dos usuários existentes serão preservadas.</p>
  </section>:null}
  {/* Persist selected values even when search or a collapsed group hides its checkbox. */}
  {Array.from(checked).sort().map(id=><input key={id} type="hidden" name="permissionId" value={id}/>)}
  {groups.map(group=>{const items=visible.filter(p=>p.module===group);if(!items.length)return null;return <details key={group} open={!!search||['Clientes e unidades','Documentos e EVA','Trading Hub'].includes(group)} style={{marginBlock:10,border:'1px solid var(--color-border, #70869d)',borderRadius:8,padding:10}}>
   <summary style={{cursor:'pointer',fontWeight:700}}>{group} · {options.filter(p=>p.module===group&&checked.has(p.id)).length} selecionadas</summary>
   {items.map(p=>{const can=allowed(p),isChecked=checked.has(p.id),reason=p.availability?.[role.id]?.reason;return <label key={p.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'12px 4px',overflowWrap:'anywhere'}}>
    <input type="checkbox" checked={isChecked} disabled={!can&&!isChecked} onChange={e=>change(p,e.target.checked)} style={{marginTop:4}}/>
    <span><strong>{p.name||p.code}</strong>{p.description?<small style={{display:'block',marginTop:4}}>{p.description}</small>:null}{!can?<small style={{display:'block',marginTop:4}}>Indisponível: {reason||'Ação não autorizada para esta função.'}{isChecked?' Você pode desmarcar para retirar da seleção.':''}</small>:null}</span>
   </label>;})}
  </details>;})}
  {!visible.length?<p>Nenhuma ação encontrada. Tente o nome do módulo ou outra ação.</p>:null}
  <details><summary>Conferir resumo das {checked.size} liberações</summary><ul style={{maxHeight:240,overflowY:'auto'}}>{options.filter(p=>checked.has(p.id)).map(p=><li key={p.id}>{p.module} · {p.name}</li>)}</ul></details>
  <p>Licença, cota, unidade autorizada e aprovações continuam obrigatórias. Selecionar uma ação não publica fechamentos nem concede administração da plataforma.</p>
 </fieldset>;
}
