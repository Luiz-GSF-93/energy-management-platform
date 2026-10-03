# Resolução de preenchimentos em lote

O assistente reúne os sintomas do diagnóstico em frentes de trabalho, preservando todos os apontamentos e a contagem real. Uma tarifa ausente pode provocar diversos bloqueios de composição; agrupar esses sintomas não significa liberar a apuração.

## Preparação automática

Ao abrir a conferência, o painel prepara os parâmetros ACL ausentes que têm rubrica, preço, posto, quantidade e tributo embutido comprovados na evidência atual. São necessários identidade e consumo previamente conferidos, unidade ativa, competência única, layout suportado e conciliação da distribuidora consistente. Demanda utilizada/não utilizada exige classificação humana atual. A medição de demanda continua separada da demanda faturada e contratada.

As operações reutilizam os serviços, validações e trilhas existentes. Cada parâmetro recebe identidade determinística por organização/documento/hash/rubrica/posto. Repetir uma requisição não cria outro registro; revisão manual divergente, vigência diferente, alteração de contexto da unidade ou fonte incompatível são preservadas como conflito. Tributos presentes no preço bruto são declarados como INCLUDED, com referências e revisões das bases pertinentes àquela linha; não são acrescidos novamente. Não há mudança na confiança OCR.

Somente rascunhos são criados automaticamente. Registros manuais existentes não são corrigidos sem validação do operador. A biblioteca ACR e parâmetros aprovados são preservados. Mudanças de evidência ou resultado incerto interrompem o lote, com recibos das etapas concluídas; nova tentativa exige consulta atualizada. Não há migração nova.

## Validação do operador

O formulário em três seções mostra os valores atuais, propostas e fontes:

1. Corrigir rascunhos tributários da competência para bases incluídas; preparar revisão dos dados mensais e conferir demanda medida. Escolher quadro de medição ou histórico usa o maior valor entre postos no cenário verde. Manter o valor anterior é a opção inicial. Copiar parcelas faturadas para ACR exige seleção explícita.
2. Preparar revisão de custos, mantendo todos os itens existentes, e acrescentar CIP ACL comprovada. NF do fornecedor já enviada aparece na mesma tela, com acesso privado. O valor contratual sugerido **não é extração da NF**. A inclusão do fornecedor exige escolha da NF da mesma unidade/competência, valor documental, tratamento tributário, confirmação do PDF e justificativa. Nenhum custo do fornecedor é inferido quando essa escolha não foi feita.
3. Confirmar as alterações e registrar motivo. Registros mensais/custos validados são sucedidos por novas versões DRAFT; originais e histórico permanecem íntegros. Rascunhos de outra origem são preservados para revisão específica.

## Aprovação financeira

Somente gestor/administrador autorizado pode aprovar os parâmetros revisados. A ação exige confirmação própria e todas as tarifas sem conflito e tributos previamente corrigidos. As referências tributárias são atualizadas para as revisões das tarifas aprovadas. Operacional não ganha aprovação genérica de contratos, medições, custos ou apuração. Este fluxo não aprova nem publica settlement; as validações financeiras e publicação existentes permanecem obrigatórias.

## Caso Tennis Country, agosto/2026

Diagnóstico inicial: 14 bloqueios. ACL sem tarifas; ACR já tinha biblioteca CPFL aprovada. ICMS e PIS ACL eram rascunhos manuais com bases vazias, COFINS ausente. Dados mensais v2 tinham demanda medida 500 kW e reativo fora ponta 2320,1629 kWh; evidência OCR apresentava reativo faturado 2320,4823 kWh e parcelas faturadas utilizada 255,6/não utilizada 244,4 kW. Não se substitui a demanda medida por essas parcelas. Custos v2 continham apenas CIP ACR; NF do fornecedor estava enviada, mas não registrada nos custos. Compra contratual de 77,542 MWh frente a consumo 77,48898 MWh mantém diferença de 0,05302 MWh para conciliação documental.

A automação prepara rascunhos e reduz navegação/manualidade; não elimina ressalvas por suposição. CCEE/PLD continuam aguardando validação do certificado e habilitação. Ausência não é zero. Não se promete conclusão em 5–10 segundos: processamento, disponibilidade das fontes e revisão humana devem ser medidos na operação real.

## Verificação

- Testes de fluxo e montagem do contexto: fonte atual, tenant/RBAC/licença, quantidade divergente, vigência, tributos por linha, confirmação humana, revisão de medições/custos, NF privada, aprovação exclusiva e falhas parciais.
- PostgreSQL isolado (PGlite): identidade estável, igualdade de JSONB, histórico único em repetição, isolamento por organização e preservação de aprovados.
- Interface isolada: preparação única, 14 apontamentos preservados, revisão em lote, confirmação separada, falha sem repetição e respostas obsoletas descartadas.
- Regressões de OCR, parâmetros, custos, medições, preparação e publicação; compilação Nest/Next e lint do escopo.
