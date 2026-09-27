# F1.101 — Vincular bases CDE às declarações TUSD existentes

Na homologação CPFL Paulista, as declarações ICMS/PIS/Cofins criadas pela F1.96 abrangiam somente TUSD. A nova seção “Vincular CDE aos tributos da distribuidora” mostra as quatro bases e permite ampliar individualmente cada declaração em rascunho após aprovação de TUSD e CDE.

## Comportamento
- Reutiliza o mesmo parâmetro tributário e a edição auditada de CalculationParametersService: revisão otimista, autor autenticado e evento de histórico. Cada declaração é uma edição independente; a consulta informa quais já foram ampliadas e permite continuar as restantes.
- Preserva texto anterior e acrescenta justificativa, origem, token da prévia e valores de conciliação. Não cria nova declaração, alíquota, cobrança ou aprovação.
- Exige identidade/consumo/descrição CDE atuais, competência e totais conciliados, evidências numéricas válidas, quatro bases aprovadas compatíveis com a fonte, unidade, cenário e vigência.
- Restrita a gestor/administrador com permissão de alteração, acesso a documentos/contratos e licença vigente. Cliente, organização e unidade são resolvidos no backend.
- Base manual, revisão divergente, declaração concorrente, registro aprovado/retirado ou destaque ausente impedem edição automática. Notas longas nunca são truncadas. Repetição após sucesso retorna o vínculo existente.
- A aprovação tributária segue separada e valida novamente as revisões da base. Demais componentes, fornecedor e fechamento completo continuam fora deste recorte.

## Del Rei, agosto/2026
Memória parcial TUSD + CDE: ICMS 5.929,67; PIS 278,23; Cofins 1.304,74. Todos são destaques já incluídos nas tarifas brutas, não valores adicionais nem alíquotas.

## Validação
Testes do novo serviço cobrem DTO real de edição, revisão/autor, idempotência, edição independente, bases não aprovadas, alteração de escopo, evidência revogada, dado ausente, conflito, notas e RBAC. Testes DOM cobrem prévia, envio estruturado, recibo, bloqueio de repetição e falha de consulta. Regressões CDE/TUSD e builds backend/frontend.

Sem migração de banco. Nenhuma aprovação de parâmetro é executada por esta entrega.
