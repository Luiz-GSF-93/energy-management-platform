import {createHash,createHmac} from 'node:crypto';
import {TEAM_FROM,TEAM_SUBJECT,TEAM_TEMPLATE,teamVariables,templateSnapshot,verifyTeamWebhook} from './team-notification.security';
const row={profile:'OWNER',display_name:'Luiz <script>&',recipient:'luiz@example.com',validated_at:'2026-10-14T12:00:00Z'};
const html='<p>{{{NOME_USUARIO}}} {{{PERFIL}}} {{{ATRIBUICOES}}} {{{DATA_VALIDACAO}}}</p>';
const version='approved-v1',hash=createHash('sha256').update(html).digest('hex');
const template={id:TEAM_TEMPLATE,status:'published',current_version_id:version,html,from:TEAM_FROM,subject:TEAM_SUBJECT};
describe('Platform team notification payload',()=>{
 it('escapes names without changing privileges or creating a login token',()=>{const vars=teamVariables(row);expect(vars.NOME_USUARIO).toBe('Luiz &lt;script&gt;&amp;');expect(templateSnapshot(template,version,hash,vars).html).not.toContain('<script>');expect(vars.PERFIL).toBe('Owner');});
 it.each(['SUPPORT','FINANCE','ADMINISTRATOR','OWNER'])('uses trusted responsibilities for %s',profile=>expect(teamVariables({...row,profile}).ATRIBUICOES.length).toBeGreaterThan(20));
 it.each([{profile:'admin_platform'},{recipient:'test@example.com\r\nBcc:x@y.com'},{recipient:'invalid'},{display_name:''},{validated_at:'never'}])('blocks invalid identity %j',change=>expect(()=>teamVariables({...row,...change})).toThrow());
 it.each([{status:'draft'},{html:html+'changed'},{current_version_id:'new'},{from:'attacker@example.com'},{subject:'new'}])('blocks unapproved template changes %j',change=>expect(()=>templateSnapshot({...template,...change},version,hash,teamVariables(row))).toThrow());
 it('requires approved hash/version and all placeholders',()=>{expect(()=>templateSnapshot(template,'',hash,teamVariables(row))).toThrow();expect(()=>templateSnapshot(template,version,'',teamVariables(row))).toThrow();const changed={...template,html:html+'{{{UNAPPROVED}}}'};expect(()=>templateSnapshot(changed,version,createHash('sha256').update(changed.html).digest('hex'),teamVariables(row))).toThrow();});
});
describe('Authenticated Resend events',()=>{
 const now=Date.parse('2026-10-14T12:00:00Z'),secret='whsec_'+Buffer.alloc(32,7).toString('base64');
 const raw=Buffer.from(JSON.stringify({type:'email.delivered',created_at:'2026-10-14T11:59:58Z',data:{email_id:'12345678-1234-4123-8123-123456789012'}}));
 function headers(body=raw,stamp=String(now/1000)){const id='msg_test123';return {'svix-id':id,'svix-timestamp':stamp,'svix-signature':'v1,'+createHmac('sha256',Buffer.alloc(32,7)).update(id+'.'+stamp+'.').update(body).digest('base64')};}
 it('accepts exact raw body and valid timestamp',()=>expect(verifyTeamWebhook(raw,headers(),secret,now)).toMatchObject({state:'DELIVERED'}));
 it('rejects altered body, old/future signatures and wrong secret',()=>{expect(()=>verifyTeamWebhook(Buffer.concat([raw,Buffer.from(' ')]),headers(),secret,now)).toThrow();for(const shift of [-301,301])expect(()=>verifyTeamWebhook(raw,headers(raw,String(now/1000+shift)),secret,now)).toThrow();expect(()=>verifyTeamWebhook(raw,headers(),'whsec_'+Buffer.alloc(32,8).toString('base64'),now)).toThrow();});
 it('supports signature rotation but not unsigned events',()=>{expect(verifyTeamWebhook(raw,{...headers(),'svix-signature':'v1,wrong '+headers()['svix-signature']},secret,now)).toMatchObject({state:'DELIVERED'});expect(()=>verifyTeamWebhook(raw,{},secret,now)).toThrow();});
 it('bounds size and does not interpret unrelated events as account activation',()=>{expect(()=>verifyTeamWebhook(Buffer.alloc(65537),headers(),secret,now)).toThrow();const other=Buffer.from(JSON.stringify({type:'email.opened'}));expect(verifyTeamWebhook(other,headers(other),secret,now)).toEqual({ignored:true});});
 it('extracts only signed exact flow correlation, rejecting changed sender and multiple recipients',()=>{
  const data={email_id:'12345678-1234-4123-8123-123456789012',tags:{flow:'platform-team',notification:'11111111-1111-4111-8111-111111111111'},from:TEAM_FROM,subject:TEAM_SUBJECT,to:['TEST@example.com']};
  const body=(change:any={})=>Buffer.from(JSON.stringify({type:'email.delivered',created_at:'2026-10-14T11:59:58Z',data:{...data,...change}}));
  const good=body();expect(verifyTeamWebhook(good,headers(good),secret,now)).toMatchObject({correlation:{notification:data.tags.notification,recipient:'test@example.com'}});
  for(const change of [{from:'wrong@example.com'},{to:['test@example.com','second@example.com']}]){const bad=body(change);expect(()=>verifyTeamWebhook(bad,headers(bad),secret,now)).toThrow();}
 });
});
