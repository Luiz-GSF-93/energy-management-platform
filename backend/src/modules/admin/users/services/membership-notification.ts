import {WelcomeContext,welcomeContent} from './welcome-content';
import {membershipEmailHtml} from './membership-email-template';
export type MembershipNotificationStatus = 'accepted' | 'unavailable' | 'failed';
export async function sendMembershipNotification(input: WelcomeContext & { membershipId: string; email: string; event?: 'reactivated'; scopeEventId?:string; scopeActive?:boolean }): Promise<MembershipNotificationStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'unavailable';
  try {
    const base = new URL(process.env.FRONTEND_URL || 'https://app.expertenergy.com.br');
    if (base.protocol !== 'https:') return 'unavailable';
    const login = new URL('/auth/login', base).toString();
    const content = welcomeContent(input);
    const text = [input.event==='reactivated'?'Seu acesso à organização foi reativado.':'Bem-vindo ao EnergyOS. Seu acesso foi preparado.', '', 'Ambiente: '+content.audienceLabel, 'Organização: '+input.organizationName, ...(content.audience==='portal'?['Empresa: '+input.customerName]:[]), 'Função: '+content.roleLabel, 'Vínculo: '+(input.affiliationType==='external'?'Externo / consultor':'Interno à organização'), '', content.instructions, '', 'Acesse '+login+' com seu e-mail e senha atuais.', 'Se participar de mais de uma organização, selecione a organização desejada após entrar.', 'Se não lembrar sua senha, use Esqueci minha senha na tela de login.', '', 'Este aviso não altera seus acessos nas demais organizações.'].join('\n');
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST', signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':input.scopeEventId?'organization-portal-scope/'+input.scopeEventId:'organization-membership/'+input.membershipId},
      body:JSON.stringify({from:process.env.MEMBERSHIP_EMAIL_FROM || 'EnergyOS <nao-responda@notificacoes.expertenergy.com.br>',to:[input.email],subject:input.scopeEventId?'Seu acesso ao Portal foi atualizado — EnergyOS':input.event==='reactivated'?'Seu acesso foi reativado — EnergyOS':'Bem-vindo ao EnergyOS',text:input.scopeEventId?['Atualização de acesso ao Portal do cliente — EnergyOS','Organização: '+input.organizationName,'Empresa: '+input.customerName,'Situação: '+(input.scopeActive?'Acesso autorizado':'Acesso revogado a este cliente'),'Unidades autorizadas: '+(input.unitNames?.join('; ')||'Nenhuma unidade'),content.instructions,'Acesse '+login+' com seu e-mail e senha atuais. Os acessos às demais organizações e a senha permanecem preservados.'].join('\n'):text,html:membershipEmailHtml(input,login)}),
    });
    if (!response.ok) return 'failed';
    const result = await response.json() as {id?: unknown};
    return typeof result.id==='string' && result.id.length>0 ? 'accepted' : 'failed';
  } catch { return 'failed'; }
}
