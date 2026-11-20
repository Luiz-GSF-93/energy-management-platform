import{randomUUID}from'node:crypto';
import{emailAddress}from'./communications-policy.mjs';
export function createSubmissionNotifications({store,provider,publicOrigin,enabled=false}){
 return{
  async schedule(c,message){if(!enabled||message.payload.purpose!=='submission'||!['accepted','delivered'].includes(message.state))return;
   const recipients=message.payload.notification_recipients??[];if(!recipients.length)return;
   const notifications=recipients.map(email=>({id:randomUUID(),recipient:emailAddress(email),payload:{subject:'Projeto encaminhado à distribuidora · EnergyOS PEE',project:message.payload.project_name,project_id:message.payload.project_id,url:publicOrigin+'/app#'+new URLSearchParams({project:message.payload.project_id,view:'reports'}).toString(),message_id:message.id}}));
   await store.notify(c,'schedule',{message_id:message.id,notifications});
  },
  async list(c,message){if(!enabled||message.payload.purpose!=='submission')return[];return store.notify(c,'list',{message_id:message.id});},
  async process(){if(!enabled||!provider?.submissionNotice)return;for(let i=0;i<2;i++){const job=await store.notifySystem('claim',{});if(!job)return;let provider_id=null,state='unknown';try{const result=await provider.submissionNotice({id:job.id,recipient:job.recipient,...job.payload,origin:publicOrigin});provider_id=result.id;state='accepted';}catch{}await store.notifySystem('finish',{id:job.id,state,provider_id});}}
 };
}
