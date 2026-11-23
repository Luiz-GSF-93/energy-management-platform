import {ServiceUnavailableException} from '@nestjs/common';
/** A timeout cannot prove rollback. Never retry here: the request id and
 * persisted preparation journal must be reconciled before another attempt. */
export async function closingPreparationCommand(db:any,name:string,args:any,milliseconds?:number):Promise<any>{
 const defaults=name==='ensure_management_fee_default';
 if(!defaults&&(name!=='eva_scoped_closing_action'||!['reserve','finish'].includes(args?.p_action)))throw Error('CLOSING_PREPARATION_COMMAND_NOT_ALLOWLISTED');
 const stage=defaults?'fee-default':args.p_action;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const unavailable=()=>new ServiceUnavailableException({code:'EVA_CLOSING_COMMAND_UNCONFIRMED',stage,message:'A confirmação da preparação não chegou no prazo. As fontes foram preservadas. Consulte o histórico e o protocolo antes de repetir; não reenvie as faturas ou notas.'});
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},milliseconds??(defaults?12000:90000));timer.unref?.();});
 try{return await Promise.race([Promise.resolve().then(()=>{const request=db.rpc(name,args);return typeof request.abortSignal==='function'?request.abortSignal(controller.signal):request;}),deadline]);}
 catch(error){if((error as any)?.getResponse?.()?.code==='EVA_CLOSING_COMMAND_UNCONFIRMED')throw error;throw unavailable();}
 finally{clearTimeout(timer!);}
}
