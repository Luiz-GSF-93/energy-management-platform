# F1.106 — CIP da fatura nos custos mensais

A contribuição de iluminação pública da CPFL Paulista pode criar o primeiro rascunho de custos da unidade/competência pelo painel de homologação, sem redigitação do valor.

## Regras

- Fonte CPFL Paulista grupo A/ACL, cliente/unidade ativos, competência e totais conciliados e conferências atuais de identidade/consumo. A fonte reutiliza as verificações estritas da integração TUSD.
- Uma única linha PUBLIC_LIGHTING/CHARGE, origem sem mesclagem, descrição CIP e mês explícito coincidente, valor positivo exato em centavos e confiança de descrição/valor acima de 85%. Confiança direta baixa não é substituída; fallback somente por palavras verificadas.
- Criação DRAFT, origin OCR_CIP, cenário ACL, categoria CHARGE e taxTreatment UNSPECIFIED. Ausência de destaque tributário não declara isenção. Nenhuma aprovação financeira automática.
- Importação parcial somente CIP. TE/desc. ACL, subtotais, devoluções e subvenção excluídos desta etapa. Revisar composição completa antes de validar.
- Qualquer lançamento mensal existente é preservado. Token vincula fonte e estado atual; ID determinístico e bloqueio transacional existente impedem duplicidade/reenvio. Nunca atualiza custos existentes.
- Autor real, hash do documento, linha/página da evidência e token de integração. Histórico capturado pelo trigger existente. Origem permanece imutável; RLS e permissões preservadas.
- A tela confirma gravação, exibe a versão/revisão e leva diretamente aos custos mensais da fatura.

## Banco e implantação

Aplicar 20260927_f1_106_ocr_cip_costs.sql antes de usar a importação. Apenas amplia a enumeração de origem MANUAL/OCR_CIP; não modifica registros, políticas ou permissões. Os triggers de histórico, versão, imutabilidade e validação são mantidos.

## Validação

55 testes Jest (candidato, integração CIP, integração TUSD e custos), 70 verificações de banco/serviço em PGlite, teste de interface de envio somente do token/recibo/falha/troca de documento, builds backend/frontend e git diff --check aprovados.

A homologação completa ainda depende das medições e da composição integral de custos, contratos e parâmetros aplicáveis. A extração original e as conferências já salvas não são alteradas.
