# Adendo ao prompt mestre — GD e Expert Energy Audit Intelligence™

Solicitação do usuário em 26/09/2026. Extensão incremental, sem substituir etapas existentes.

## Fase 5 em andamento: OCR, incluindo GD

F1.65 recebe candidatos de consumo GD, energia injetada/compensada, créditos recebidos/utilizados/expirados, saldos anterior/atual e percentual de rateio. Preserva texto, decimal, unidade, página, confiança, origem e versão. O painel aparece no documento e os candidatos são carregados automaticamente na preparação da unidade/competência. Não são lançamentos aprovados; nenhuma gravação financeira é feita. Indícios GD bloqueiam a consolidação até conciliação. Ausência de campo não significa zero ou ausência de GD.

Próximas entregas da mesma fase, antes da automação financeira:
1. Homologar identificação e layout de todas as páginas; distinguir histórico, competência atual e unidade geradora/beneficiária. A presença de “Micro e Mini Geração”, “crédito” ou “compensação” isolada não comprova GD.
2. Cadastro versionado de perfil/modalidade SCEE, vínculos gerador-beneficiário, UC origem/destino, rateio e vigência. Rateio GD é independente de honorários. Créditos precisam de origem, competência de geração e vencimento documentado.
3. Conferência persistida/versionada com origem, hash e autor; confiança <45% rejeita automação, 45–85% requer revisão, >85% somente com identidade, completude e conciliação aprovadas.
4. Importação atômica e idempotente para medições, custos e parâmetros; não sobrescrever versões validadas. Manter cenário real separado da referência ACL/ACR.
5. Motor GD conciliando consumo, compensação e saldos por posto; custos não compensáveis, regras e vigências homologadas. Não somar duas vezes quantidades TE/TUSD nem converter créditos kWh em economia monetária sem regra e baseline aprovados.

Depois das etapas em andamento: seguir roteiro existente de CCEE, dashboards, agenda/eventos, IA, relatórios, hardening e homologação. O novo módulo abaixo será implantado posteriormente em subetapas, sem desenvolver tudo simultaneamente.

## Futuro módulo: Expert Energy Audit Intelligence™

### Bibliotecas versionadas
- Distribuidoras Expert Energy™: CPFL, ENEL, EDP, Neoenergia, Equatorial, Light, Cemig, Celesc, Copel, Energisa, RGE, AES Sul, Coelba, Cosern, Elektro, Eletropaulo (histórico), Ampla (histórico), CEEE, Cemar e Cepisa. Guardar entidade, identificador regulatório, aliases, sucessões e vigências. Esta lista é backlog, não homologação.
- Layouts: CPFL Paulista, Piratininga e Santa Cruz como exemplos distintos; modelo da fatura, campos, histórico de alterações e regras específicas, com fixtures autorizadas.
- Dicionário: “Energia Ativa FP”, “Consumo Fora Ponta”, “Energia Elétrica Fora Ponta” por contexto/layout/unidade. Posto identificado não prova que a tarifa é somente TE ou TUSD.
- Tributária: ICMS, PIS, COFINS e COSIP/CIP por fonte, base, exclusões e vigência. Bandeiras entram como componentes tarifários, não como tributos presumidos.
- Tarifária: TE, TUSD, demanda, ultrapassagem, reativo e bandeiras por distribuidora, resolução, grupo, modalidade, posto e período. Comparar tarifa faturada e regulada somente com bases tributárias equivalentes.

### Auditoria e base de erros
- Demanda: contratada, medida, faturável e excedente.
- Reativo: exemplo de fator de potência 0,92 condicionado a enquadramento/norma.
- Ultrapassagem: exemplo de medição >105% não será regra universal; parametrizar limites e vigências conforme enquadramento.
- Cobranças indevidas e erros de ICMS, demanda, reativo, bandeira, GD e compensação: indícios rastreáveis, validação humana, tratamento, resolução e recuperação efetiva. Não declarar cobrança indevida sem evidência.

### Metodologia proprietária
IEE — Índice de Eficiência Expert; ESI — Energy Savings Index; Expert Score — nota de gestão energética; ACL Score — probabilidade de sucesso na migração. Fórmulas, pesos, escala, baseline, normalização, dados mínimos, calibração e versionamento dependem de aprovação de metodologia. Não inventar notas ou probabilidades.

### Benchmark nacional
Coortes por grupo/modalidade (ex.: A4 Verde), setor (ex.: alimentos) e porte (ex.: 400 kW). Exigir anonimização efetiva, política de uso, amostras mínimas e supressão de grupos reidentificáveis, sem acesso cruzado a documentos de tenants. Ajustar período/sazonalidade/unidade comparável. “12% acima da média nacional” é exemplo do usuário, não resultado calculado nem autorizado sem base representativa.

## Referências para homologação regulatória
- https://www.gov.br/aneel/pt-br/assuntos/geracao-distribuida
- https://www2.aneel.gov.br/cedoc/ren20211000.pdf
Nenhuma regra regulatória/tributária nova é ativada por este adendo.
