// Recovery runs only during an explicit login, never during an in-progress form refresh.
export async function resolveLoginContext<T>(deps: {
 context:()=>Promise<T>; platform:()=>Promise<T>; clearOperation:()=>void;
 organizations:()=>Promise<Array<{organizationId:string;role:string}>>;
 switchOrganization:(id:string)=>Promise<unknown>; forbidden:(error:unknown)=>boolean;
}, recoverOrganization=false): Promise<T> {
 try {return await deps.context();} catch(error) {if(!deps.forbidden(error)) throw error;}
 deps.clearOperation();
 try {return await deps.platform();} catch(error) {if(!deps.forbidden(error) || !recoverOrganization) throw error;}
 const organizations=(await deps.organizations()).filter(o=>typeof o.organizationId==='string' && o.organizationId.length>0 && o.role!=='admin_platform').sort((a,b)=>a.organizationId.localeCompare(b.organizationId));
 if(!organizations.length) throw new Error('Seu usuário não possui vínculo ativo com uma organização. Solicite acesso ao administrador.');
 await deps.switchOrganization(organizations[0].organizationId);
 return deps.context();
}
