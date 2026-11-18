# EVA — conciliação de cópias fiscais e fechamento (18/11/2026)

## Problema e comportamento
Uma NF enviada como XML e DANFE PDF podia permanecer como duas fontes inconciliáveis. No layout nativo, a chave agrupada vinha na primeira linha antes dos títulos. O XML identificava a unidade; o PDF, com endereço fiscal distinto e sem UC, permanecia candidato de revisão. Mesmo com cobertura já confirmada, o custo que apontava para o PDF não era consumido pela NF canônica e impedia o cálculo final.

A chave válida na primeira linha agrupada da DANFE passa a ser reconhecida, além da posição rotulada existente. Uma cópia em revisão só herda a associação da nota já identificada quando a chave fiscal é idêntica e mês, quantidade, valor total, preço na precisão impressa e tributos conhecidos são compatíveis. Referência a outra NF, CNPJ comum isolado ou valor contraditório não estabelecem essa equivalência.

As fontes e SHA-256 permanecem individuais. A memória registra a relação entre cópia e original canônico. Quantidade e valor são somados uma vez. Um custo referenciado à cópia é consumido uma vez; dois lançamentos da mesma NF continuam exigindo conciliação.

Uma confirmação anterior do mesmo conjunto é reaproveitada somente quando as notas econômicas e todos os hashes originais são idênticos. A assinatura anterior é recalculada a partir das fontes atuais; alterar fonte, incluir outra nota ou divergir os valores invalida o reaproveitamento. Sem autor atribuído não há confirmação. Não há OCR/IA paga, aprovação financeira ou publicação automática nesta conciliação.

## Validação
Testes de regressão: leitura da chave antes dos títulos e ambiguidade; cópias XML/PDF; preço arredondado na DANFE; conflito de tributos; preservação da confirmação; alteração do conjunto; ausência de associação da unidade; dupla cobrança por duas referências. Suites existentes de evidência, preparação e fechamento mantidas. Leitura real dos originais preservados conferida sem escrita financeira ou nova inferência.

## Tarifas e honorários
A existência de ACR calculado é independente da conclusão das demais fontes. Não converter subtotal de energia em ACR final. A biblioteca deve respeitar distribuidora, enquadramento e vigência. A base individual/consolidada do honorário é uma regra comercial explícita por competência; esta correção não altera contratos ou tarifas de outras organizações.

## Plano A–G: limites desta entrega
A/C: correção compatível no processamento existente e reaproveitamento de protocolos/fontes, sem segundo worker nem execução síncrona pesada no navegador.
B: ainda exige amostra representativa de 24–72h de backlog, memória, event loop, latência e falhas externas.
D: Collector/Prometheus/Grafana existentes não dispensam teste de indisponibilidade de exportação, limites, ausência de vazamento e alertas ao Owner.
E: outbox/consumidores e migração gradual de cada etapa continuam separados; esta conciliação não introduz um broker.
F: regressões direcionadas não substituem carga e injeção de falhas (rede/Auth/worker/duplicação/reordenação).
G: saída BETA depende de SLO medido, isolamento, ausência de duplicidade financeira, recuperação e rollback demonstrados. Não prometer ausência absoluta de falhas.
