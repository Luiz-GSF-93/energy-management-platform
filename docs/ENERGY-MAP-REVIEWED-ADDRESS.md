# Endereço cadastral revisado pelo OCR — etapa 2

O backoffice autorizado pode corrigir endereço, cidade e UF da unidade a partir da conferência do PDF original. A correção não aprova valores financeiros, não modifica a extração e não confirma coordenadas.

## Fluxo e limites

Em Documentos, abrir **Conferir identidade e competência**, depois **Comparar endereço para correção**. O sistema mostra o cadastro e os candidatos do OCR com página, origem e confiança. O operador deve conferir PDF, CNPJ e UC, preencher os três campos estruturados e justificar com pelo menos 20 caracteres. Não há preenchimento ou salvamento automático a partir do texto do OCR.

Disponível apenas nas organizações habilitadas no mapa, com licença vigente, módulo documental, vínculo de backoffice e permissões de visualizar documentos, processar OCR, visualizar o mapa e clientes e administrar unidades. A operação administrativa da plataforma mantém a sessão de organização existente. O portal do cliente não possui essa ação.

Layouts CPFL Paulista A e Neoenergia Elektro verde são aceitos quando CNPJ completo e UC correspondem ao cadastro atual, existe origem verificável e o endereço tem um único candidato textual. CNPJ oculto/parcial, divergência de identidade, duplicidade, layout não reconhecido ou origem ambígua bloqueiam a correção. A confiança original, inclusive baixa ou ausente, é preservada para conferência humana explícita.

## Consistência e auditoria

GET e POST `/api/v1/documents/:id/ocr/address-correction` exigem contexto autenticado e respondem com `private, no-store`. O cliente fornece somente os três campos, justificativa, confirmações, versão, hash da prévia e UUID da solicitação. O servidor reconstrói a origem e nunca aceita snapshots, organização ou ator enviados pelo cliente.

A migração `20261005_f14_reviewed_unit_address.sql` cria histórico imutável com acesso direto revogado, funções privadas ao backend e RLS. A transação revalida ator, permissões, unidade, cadastro de identidade, documento verificado, hash, competência e processamento OCR concluído. A correção cadastral existente e o registro de origem são atômicos. Mudanças concorrentes exigem nova conferência. Repetir o mesmo UUID/payload retorna o resultado original; alterar ator, documento ou payload impede reuso.

O endereço alterado muda o hash cadastral usado pelo mapa. Coordenadas anteriores permanecem no histórico, mas não são publicadas como localização vigente. O usuário atualiza a unidade e solicita a busca na fila; sugestões continuam exigindo confirmação humana. Não há nova consulta paga automática nesta ação. Mantêm-se os limites do piloto (10 consultas/organização/dia e 100 totais/mês) e o envio à Mapbox somente do endereço, cidade e UF.

## Validação

Testes de serviço cobrem payload fechado, origem verificável, identidade, papel/permissão, organização, versão/hash, replay e concorrência. PGlite executa as migrações reais de correção cadastral e deste fluxo, incluindo atomicidade, auditoria imutável e revogação. Testes React cobrem revisão explícita, texto seguro, campos estruturados, retry, bloqueio por identidade e descarte de respostas após troca de organização.

## Próximas etapas

Etapa 3 exige indicadores derivados exclusivamente de apurações validadas e publicadas, alertas com origem demonstrável e acesso do cliente restrito às unidades relacionadas. Etapa 4 já possui densidade visual de pontos conferidos; agregações comerciais autorizadas, consulta por raio e score com metodologia/versionamento ainda precisam de implementação e validação. Não apresentar essas etapas como concluídas apenas pela existência do mapa.
