# F1.84 — Edição auditada de clientes e unidades

Clientes e unidades em /backoffice/setup passam a oferecer edição e histórico. As alterações exigem justificativa e registram autor autenticado, data e retratos anterior/posterior. O formulário de configuração elétrica em Contratos utiliza a mesma operação auditada.

## Situação do cliente e vagas

Não há licença por cliente. A licença continua sendo da organização. A desativação de um cliente pode desativar os usuários externos de consulta explicitamente declarados exclusivos dele, na mesma transação. O uso de vagas é obtido pela contagem existente de membros ativos. Não são vinculados usuários automaticamente na instalação.

O vínculo é exclusivamente de ciclo de vida, não concede nem restringe permissões de dados. Usuários compartilhados/backoffice ficam sem vínculo exclusivo. Contas internas, gestores, administradores, operadores, o próprio autor e administradores globais são protegidos. Vínculos de outras organizações são preservados. Associar usuários exige permissão de atualização de usuários; desativá-los também passa pelas autorizações existentes de status. Reativar cliente não reativa membros nem contorna cotas.

## Integridade

Migração: backend/src/database/migrations/20260927_f1_84_registration_edits.sql. Audit trail imutável com RLS, acesso RPC somente service_role, isolamento por organização no servidor, controle otimista edit_version e idempotência request_id. Qualquer erro aborta cadastro, vínculos, status dos membros e auditoria juntos. Nenhuma edição dos dados reais de Del Rei foi realizada para testar.

## Verificação

618 testes Jest (32 suítes) de clientes, unidades e OCR aprovados. 22 verificações SQL isoladas em PGlite: isolamento entre organizações, exclusividade, preservação de compartilhados/backoffice, reativação sem ativar membros, conflitos de versão, repetição idempotente, auditoria imutável e rollback integral. Backend compilado. Frontend verificado por build e ESLint antes da publicação.

## Continuidade

Após correções cadastrais justificadas pelo operador, refazer a conferência de identidade OCR. Esta entrega não homologa a fatura nem importa suas informações automaticamente. O fluxo de homologação continua exigindo as revisões pendentes da etapa anterior.
