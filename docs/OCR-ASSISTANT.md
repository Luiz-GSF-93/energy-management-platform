# Assistente de conferência e preparação OCR

Depois do envio de uma fatura da distribuidora com unidade e competência selecionadas, o processamento Azure existente extrai o documento privado. Quando a extração retorna, Documentos consulta automaticamente o novo assistente para essa fatura. Documentos históricos são consultados pelo botão **Assistente IA da fatura**.

O painel reúne leitura por página, confiança original, revisão de identidade/consumos/demanda, comparação com até três competências anteriores validadas, diagnóstico de cadastros/vigências e propostas de lançamentos. O histórico compara o último registro validado por mês; variação absoluta superior a 25% é um alerta operacional explícito, sem correção automática nem bloqueio financeiro. Dados ausentes ou malformados não são zero, e referência zero não produz divisão percentual.

Contratos, distribuidora, honorários, custos e parâmetros disponíveis são reutilizados pelo diagnóstico existente. Ausências e conflitos abrem os formulários da unidade/cliente/competência derivados da fatura no backend e validados contra o catálogo da organização. A área de distribuidora abre a edição da unidade existente com os dados cadastrados e justificativa obrigatória. Ao voltar à janela do assistente aberta, a conferência é atualizada. Preço do fornecedor e honorários não são inferidos da fatura.

## API e limites de autorização

- `GET /api/v1/documents/:id/ocr/assistant`: plano somente de leitura; exige simultaneamente acesso a documentos e contratos, organização resolvida e licenças de documentos/mercado livre.
- `POST /api/v1/documents/:id/ocr/assistant`: recebe exclusivamente `{token, operations, acknowledged: true}`. Exige permissão de cadastro e o papel Gestor/Administrador (ou operação da plataforma), preservando as restrições dos serviços atuais. Cada operação verifica também suas permissões específicas.

As 14 propostas reutilizam os serviços existentes: consumos, demanda faturável, TUSD, CDE, parcelas de demanda, reativo, CIP/ajustes, tributos incluídos na TUSD, três versões tributárias TUSD/CDE e três versões demanda/reativo. O layout e as evidências determinam a disponibilidade; isso não amplia o suporte OCR para distribuidoras desconhecidas.

O usuário seleciona apenas etapas disponíveis e confirma explicitamente valores/fontes. O backend recalcula o plano e compara seu SHA-256, que inclui ator, organização, arquivo, extração, revisões atuais, registros/configurações, histórico e prévias. Mudança de evidência exige nova confirmação. Confirmações de uma fonte antiga não aparecem como atuais. Leituras tributárias compartilhadas são reutilizadas apenas dentro da mesma consulta, sem cache entre organizações, solicitações ou prévias de gravação.

## Gravação, auditoria e preparação

O lote cria somente rascunhos e versões auditadas pelas APIs existentes. Não altera confiança OCR, aprova tarifas/tributos, sobrescreve publicados, elimina pendências ou publica apuração. Tributo embutido conserva o tratamento atual e não gera incidência adicional.

Cada etapa possui sua própria transação e recibo. Antes de gravar, sua prévia precisa continuar disponível e ter o mesmo token confirmado. Dependências alteradas por uma etapa anterior interrompem o lote, preservando os recibos já salvos. O operador atualiza e confirma a nova proposta. Uma falha de resposta de gravação é exibida como **verificar histórico antes de repetir**; não há repetição automática. Falha da consulta final não transforma recibos de gravações concluídas em erro.

O diagnóstico final distingue bloqueios de revisões. Ausência de bloqueios permite preparar a apuração; validação dos rascunhos, aprovação pelo gestor e publicação continuam no fluxo financeiro existente. Uma revisão DRAFT não comprova settlement aprovado.

Nenhuma alteração de schema ou migração é necessária. A implantação usa os packages de `backend/` e `frontend/`; o package raiz permanece legado. A API CCEE autenticada aguarda habilitação/validação do certificado, conforme instrução do usuário.

## Validação

Executar a compilação Nest, os testes `ocr-assistant`, as regressões OCR/preparação/finanças, a checagem TypeScript da interface e o lint estrito dos novos componentes. Testes de interface: `ocr-assistant.cjs`, `ocr-distributor-context.cjs`, `ocr-workspace-navigation.cjs`, `ocr-navigation.cjs` e publicação financeira. O harness de navegação implementa `showModal/close`, ausentes no jsdom, para testar o modal nativo sem substituir comportamento de produção.

O prompt mestre atualizado foi comparado à referência histórica: as novas diretrizes de GD, auditoria/metodologia, bibliotecas, benchmarking, geocodificação e Trading Hub foram mapeadas. Sua presença no documento não autoriza ativar módulos, fornecedores externos, mensagens ou pagamentos incidentalmente. Este incremento implementa a conferência e os lançamentos assistidos no projeto existente, sem afirmar automação integral da aplicação após OCR.
