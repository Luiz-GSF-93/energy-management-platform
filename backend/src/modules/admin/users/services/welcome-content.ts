export type WelcomeContext = {
  organizationName: string;
  roleName: string;
  affiliationType: string;
  customerName?: string;
};
export const welcomeRoleLabel = (role: string) => ({admin_org:'Administrador da organização',gestor:'Gestor',operacional:'Operador',consulta:'Consulta'}[role] || role);
export function welcomeContent(input: WelcomeContext) {
  const portal = !!input.customerName && input.roleName === 'consulta' && input.affiliationType === 'external';
  return {
    audience: portal ? 'portal' : 'backoffice',
    audienceLabel: portal ? 'Portal do cliente' : 'Backoffice',
    roleLabel: welcomeRoleLabel(input.roleName),
    instructions: portal
      ? 'No Portal do cliente, consulte os resultados publicados, visualize suas faturas e envie novos documentos pelos recursos liberados para sua empresa. Escolha a unidade e o período para consultar suas informações.'
      : 'No Backoffice, utilize os módulos liberados no menu conforme seu perfil. Suas designações e permissões são definidas pelo administrador da organização; procure-o se precisar de orientação sobre suas responsabilidades.',
  };
}
