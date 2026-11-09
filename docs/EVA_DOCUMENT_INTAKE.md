# EVA: recepção e retomada de documentos

O recebimento mantém PDF (15 MB), JPEG/PNG e acrescenta XML fiscal NF-e modelo 55 e NF3e modelo 66 (2 MB, UTF-8). O portal do cliente continua restrito à fatura da distribuidora; NF-e do fornecedor é recebida pela equipe interna.

XML é validado antes da reserva e novamente no processamento, sem Azure OCR. Entidades/DTD, instruções de processamento, namespaces divergentes, profundidade excessiva, duplicidade de destinatário e chaves inconsistentes são recusados. Hash e tamanho vinculam os bytes ao tenant, cliente, unidade e competência. XML não é renderizado como documento ativo; a conferência mostra texto escapado ou oferece download. A leitura não verifica criptograficamente assinatura nem situação na SEFAZ e não representa aprovação financeira.

O período vem de `gFat/CompetFat` ou referência explícita, nunca da emissão ou vencimento. CNPJ válido de mesma raiz requer correspondência de unidade/endereço/período. UC antiga exige decisão auditada vinculada à fonte quando ainda não consta do histórico. Escolher manualmente unidade/mês não comprova o conteúdo.

A nota do fornecedor pode propor quantidade MWh, preço e total quando um único item de energia reconcilia exatamente com o total. Tributos não são presumidos isentos. NF3e preserva os itens estruturados; campos sem mapeamento financeiro homologado continuam em conferência, sem simular layout de distribuidora ou confiança OCR. XML NFS-e e outros modelos não fazem parte desta admissão.

O worker não baixa o original a cada GET de polling ainda em andamento. Um fingerprint calculado no banco substitui as múltiplas viagens HTTP para capturar fontes; os limites e a comparação antes/depois continuam ativos. A explicação opcional por IA tem tarefa durável própria, criada na transação de preparação; não bloqueia o preenchimento determinístico. Intenção de inferência interrompida fica UNKNOWN, sem repetição paga automática.

Resultados incertos usam o procedimento administrativo existente de reconciliação. O botão reconfere efeitos, fonte e autorizações; não repete OCR, aprova ou publica valores. Revogação de licença, vínculo ou delegação continua bloqueando o trabalho.

Aplicar migrações 20261286, 20261287, 20261288 e 20261289 antes do backend novo. São aditivas, sem reprocessar publicações financeiras. Para rollback de aplicação, reverter frontend/backend; preservar originais, leituras e auditoria. Não enviar XML durante rollback para um worker anterior, que desconhece esse formato.

Validação: testes de parser hostil/identidade, worker, serviço e PGlite com isolamento, lease inválido, idempotência, revogação, fingerprint e tarefa opcional. O alerta de CPU exige acompanhamento de métricas reais; reduzir viagens HTTP não comprova, sozinho, queda de CPU ou SLA de produção. A implantação não altera plano pago, RLS, credenciais ou aprovação financeira.

Leiaute NF3e: [MOC oficial da SEFAZ-SP](https://portal.fazenda.sp.gov.br/servicos/nf3e/Paginas/Downloads.aspx). As políticas existentes de desperdício reativo/ultrapassagem de demanda e publicação ao cliente não são substituídas por esta mudança.

## CPU e conflitos não repetíveis

O incidente mostrou milhões de transações de configuração, poucos pedidos HTTP e erros repetidos `Original request changed` com SQLSTATE `40001`. A [base oficial do Supabase](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) documenta tentativas infinitas no PostgREST 14 quando um conflito de negócio usa esse código.

A migração 20261289 troca somente o código dos conflitos explícitos do recebimento EVA por `PT409`, mantendo condições, mensagens, permissões e rejeição da solicitação alterada. Falhas reais do motor mantêm sua semântica. Não introduzir `40001` como erro de negócio em novos fluxos. Os módulos legados fora do recebimento ainda exigem revisão própria antes de qualquer normalização abrangente.

Sessões já presas precisam ser identificadas por PID nos logs e conferidas em `pg_stat_activity` antes de encerramento pontual. Não reiniciar o projeto nem encerrar conexões indiscriminadamente. Medir CPU e variação de contadores após a correção; o banner pode refletir uma janela anterior.
