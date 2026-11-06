# EVA Search — configuração preparada, sem provisionamento

Aprovação recebida em 13/10/2026 cobre preparar estes arquivos. Nenhuma implantação, contratação, orçamento Azure, identidade, segredo, grant ou chamada de dados está autorizada por esta entrega.

O template ARM declarativo usa API estável 2025-05-01. Não requer Bicep ou compilador adicional. A validação local verifica estrutura e política de isolamento; não equivale à validação no servidor Azure nem comprova disponibilidade futura do nome/SKU.

## Configuração

- Assinatura prevista: Expert Energy, 15359c5b-00a5-4e27-a6a8-00ca4676f505.
- Grupo previsto: rg-expertenergy-ai. Não criar ou alterar outro grupo automaticamente.
- Nome sugerido: srch-energyos-eva-pilot; disponibilidade não conferida/reservada.
- Brazil South, Basic, uma réplica e uma partição (uma unidade Search).
- Rede pública Disabled; sem Private Endpoint ou exceção de serviços confiáveis.
- disableLocalAuth=true; authOptions omitido porque a API impede combiná-lo com essa configuração.
- Semantic Ranker desligado; sem identidade gerenciada, indexer, índices, fontes Blob, conexões Foundry ou role assignments.

A criação futura gera custo fixo mesmo sem acesso. Com a rede bloqueada e sem Private Endpoint, não há caminho de consulta de dados para o Railway. Acesso, identidades e indexação requerem fase própria; não habilitar publicamente para fazer teste rápido.

## Validação executável somente offline

`node infra/eva-search/validate.cjs`

O validador rejeita relaxamento da rede/auth, aumento de escala e inclusão de identidades/grants/segredos ou recursos adicionais. Não invoca Azure ou subprocesso de implantação.

## Roteiro futuro — requer autorização antes da execução

1. Reconferir assinatura, grupo, nome novo, SKU/região e preços. Conferir que o nome/id não existe; não atualizar um Search existente.
2. Revisar template e parâmetros. Após autorização de leitura de planejamento, usar what-if no grupo correto, em modo incremental. Se houver Modify, Delete, recurso adicional ou erro de policy, interromper e revisar; não forçar.
3. Apresentar plano final e custo ao Owner. Criação faturável e eventual aceite de termos só depois da validação específica. Não há comando create nem workflow de deployment neste pacote.
4. Depois de autorizado e criado, verificar SKU, escala, rede Disabled, chaves desabilitadas e Semantic Ranker desligado. Não revelar chaves automaticamente geradas pelo serviço.
5. Atualizar catálogo de Custos e performance: recurso provisionado e cotação/fatura separados. Orçamento interno Search aprovado: R$600/mês; aviso 80% em R$480. Isso não é orçamento Azure nem teto de cobrança.
6. Futuro orçamento Azure sugerido R$600, alertas50/80/100%, ainda não autorizado/criado. Monitoramento automático de faturamento também não é parte deste pacote.
7. Identidades separadas para indexação e consulta, escopo mínimo de índice e conectividade restrita serão aprovados depois. Não reutilizar identidade Blob nem conectar vnet01 ao Railway por suposição.
8. Executor persistido, embeddings, conferência, publicação e RAG seguem incrementos separados. Aprovação independente do corpus oficial permanece pendente até a escolha do segundo Owner. Não transformar infraestrutura em aprovação de conteúdo.

## Estimativas preservadas

Em 13/10/2026 a calculadora pública mostrou R$506,75 para730h e R$516,47 para744h de uma SU Basic BrazilSouth. Câmbio exibido5,22BRL/USD; portal da assinatura US$98,95/SU/mês. São referências distintas, não faturas nem câmbio cadastrado na plataforma. Blob, embeddings, geração, rede/tributos e serviços opcionais ficam separados. Não existe preço por PDF no custo fixo Search; documentos adicionais podem caber na capacidade, mas sua vetorização e mudanças de capacidade têm custos próprios.

## Fontes

- https://learn.microsoft.com/en-us/azure/templates/microsoft.search/2025-05-01/searchservices
- https://learn.microsoft.com/en-us/azure/search/search-security-rbac
- https://learn.microsoft.com/en-us/azure/search/service-configure-firewall
- https://learn.microsoft.com/en-us/azure/search/search-sku-manage-costs
