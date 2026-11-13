import {ServiceUnavailableException} from '@nestjs/common';

export const MANUAL_PREPARATION_RECEIPT_MS=12000;
export class UnconfirmedPreparationReceipt extends ServiceUnavailableException{
 constructor(){super({code:'EVA_PREPARATION_RECEIPT_UNCONFIRMED',message:'A resposta do protocolo não foi confirmada. Consulte o andamento antes de repetir; não reenvie os documentos.'});}
}
/** A bounded acknowledgement is not a rollback proof. Never retry a command
 * here: persisted nonces, leases and the caller's uncertainty boundary decide
 * recovery. This helper cannot wrap arbitrary financial RPCs. */
export async function manualPreparationCommand(db:any,name:string,args:any,milliseconds=MANUAL_PREPARATION_RECEIPT_MS):Promise<any>{
 const allowed:Record<string,string[]>={eva_manual_preparation_action:['request','reconcile'],eva_manual_preparation_worker:['claim','context','begin','defer','heartbeat','finish']};
 if(!Object.prototype.hasOwnProperty.call(allowed,name)||!allowed[name].includes(args?.p_action))throw Error('MANUAL_PREPARATION_COMMAND_NOT_ALLOWLISTED');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new UnconfirmedPreparationReceipt());},milliseconds);timer.unref?.();});
 try{return await Promise.race([Promise.resolve().then(()=>{const request=db.rpc(name,args);return typeof request.abortSignal==='function'?request.abortSignal(controller.signal):request;}),deadline]);}
 catch{throw new UnconfirmedPreparationReceipt();}
 finally{clearTimeout(timer!);}
}
