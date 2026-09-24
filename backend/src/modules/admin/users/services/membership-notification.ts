export type MembershipNotificationStatus = 'accepted' | 'unavailable' | 'failed';
export async function sendMembershipNotification(input: { membershipId: string; email: string; organizationName: string; roleName: string; affiliationType: string; event?: 'reactivated' }): Promise<MembershipNotificationStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'unavailable';
  try {
    const base = new URL(process.env.FRONTEND_URL || 'https://app.expertenergy.com.br');
    if (base.protocol !== 'https:') return 'unavailable';
    const login = new URL('/auth/login', base).toString();
    const labels: Record<string,string> = {admin_org:'Administrador da organização',gestor:'Gestor',operacional:'Operador',consulta:'Consulta'};
    const text = [input.event==='reactivated'?'Seu acesso à organização foi reativado na Expert Energy.':'Você recebeu acesso a uma organização na Expert Energy.', '', 'Organização: '+input.organizationName, 'Função: '+(labels[input.roleName] || input.roleName), 'Vínculo: '+(input.affiliationType==='external'?'Externo / consultor':'Interno à organização'), '', 'Acesse '+login+' com seu e-mail e senha atuais.', 'Se participar de mais de uma organização, selecione a organização desejada após entrar.', 'Se não lembrar sua senha, use Esqueci minha senha na tela de login.', '', 'Este aviso não altera seus acessos nas demais organizações.'].join('\n');
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST', signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'organization-membership/'+input.membershipId},
      body:JSON.stringify({from:process.env.MEMBERSHIP_EMAIL_FROM || 'Expert Energy <nao-responda@notificacoes.expertenergy.com.br>',to:[input.email],subject:input.event==='reactivated'?'Seu acesso foi reativado — Expert Energy':'Você recebeu acesso a uma organização — Expert Energy',text}),
    });
    if (!response.ok) return 'failed';
    const result = await response.json() as {id?: unknown};
    return typeof result.id==='string' && result.id.length>0 ? 'accepted' : 'failed';
  } catch { return 'failed'; }
}
