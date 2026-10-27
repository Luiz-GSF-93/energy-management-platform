import {WelcomeContext,welcomeContent} from './welcome-content';
import {membershipEmailHtml} from './membership-email-template';
export type MembershipNotificationStatus = 'accepted' | 'unavailable' | 'failed';
export async function sendMembershipNotification(input: WelcomeContext & { membershipId: string; email: string; event?: 'reactivated' }): Promise<MembershipNotificationStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'unavailable';
  try {
    const base = new URL(process.env.FRONTEND_URL || 'https://app.expertenergy.com.br');
    if (base.protocol !== 'https:') return 'unavailable';
    const login = new URL('/auth/login', base).toString();
    const content = welcomeContent(input);
    const text = [input.event==='reactivated'?'Seu acesso Ã  organizaÃ§Ã£o foi reativado na Expert Energy.':'Bem-vindo ao EnergyOS. Seu acesso foi preparado.', '', 'Ambiente: '+content.audienceLabel, 'OrganizaÃ§Ã£o: '+input.organizationName, ...(content.audience==='portal'?['Empresa: '+input.customerName]:[]), 'FunÃ§Ã£o: '+content.roleLabel, 'VÃ­nculo: '+(input.affiliationType==='external'?'Externo / consultor':'Interno Ã  organizaÃ§Ã£o'), '', content.instructions, '', 'Acesse '+login+' com seu e-mail e senha atuais.', 'Se participar de mais de uma organizaÃ§Ã£o, selecione a organizaÃ§Ã£o desejada apÃ³s entrar.', 'Se nÃ£o lembrar sua senha, use Esqueci minha senha na tela de login.', '', 'Este aviso nÃ£o altera seus acessos nas demais organizaÃ§Ãµes.'].join('\n');
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST', signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'organization-membership/'+input.membershipId},
      body:JSON.stringify({from:process.env.MEMBERSHIP_EMAIL_FROM || 'EnergyOS <nao-responda@notificacoes.expertenergy.com.br>',to:[input.email],subject:input.event==='reactivated'?'Seu acesso foi reativado â€” EnergyOS':'Bem-vindo ao EnergyOS',text,html:membershipEmailHtml(input,login)}),
    });
    if (!response.ok) return 'failed';
    const result = await response.json() as {id?: unknown};
    return typeof result.id==='string' && result.id.length>0 ? 'accepted' : 'failed';
  } catch { return 'failed'; }
}
