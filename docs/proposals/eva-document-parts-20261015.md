# EVA: preparação privada de documentos longos

Escopo aprovado em 15/10/2026: duas tabelas aditivas, manifesto de cobertura,
partes com páginas originais, curadoria/revisão independentes, testes e entrega
desligada. Base conferida no GitHub: `b4fa0c61b0933c1aba92fab2c3afc74168d56e69`.

## Comportamento

`EVA_DOCUMENT_PARTS_ENABLED` precisa ser exatamente `true`; o padrão é desligado.
Sem essa flag, o serviço não consulta a RPC nem processa PDF. Todas as rotas usam
escopo global, permissão existente de Owner e reconferência transacional de Owner
ativo no banco. Não há credencial ou nova permissão de usuário.

Um Owner seleciona um original já preservado e fornece os mesmos bytes à API.
O serviço compara tamanho e SHA-256 com a operação preservada. Um worker isolado
gera partes determinísticas de até 40 páginas, para originais de 101–500 páginas,
até 25 MiB. Os limites do parser anterior continuam em 100 páginas. Comparação
entre original e partes verifica texto e geometria de todas as páginas. Anexos
interativos/formulários/anotações diferentes de links são bloqueados; links são
removidos das cópias de curadoria. Não executa scripts ou anexos. Processamento
limitado a 90 segundos, 384 MiB de heap no worker, 8 MiB de assinaturas textuais e
50 MiB de PDFs derivados somados; uma divisão por processo de API por vez.

O original não é alterado. O manifesto registra hash, versão do divisor,
intervalos contínuos, hashes textuais por página, tamanho e hash de cada parte.
Contagem, ordem, lacunas, sobreposições e duplicação são validadas no serviço e
na RPC. O hash do manifesto usa a representação JSONB canônica no PostgreSQL.
Essas verificações não comprovam vigência jurídica nem substituem conferência
visual de tabelas, imagens, rasuras normativas ou notas.

Os bytes derivados não são gravados automaticamente no Blob ou no banco.
O download autenticado exige novamente os bytes originais, reproduz o manifesto
e revalida o Owner/origem antes da resposta. Na fase operacional posterior, o
Owner poderá preservar as partes pelo fluxo já existente de documentos, executar
extração/curadoria e vincular as provas atuais ao conjunto. Esta implementação
não dispara esse fluxo automaticamente nem efetua chamadas Azure.

`eva_official_document_part_sets` mantém revisões imutáveis do agregado e suas
decisões. `eva_official_document_parts` mantém as partes de cada revisão,
inclusive revisão derivada, job e versão de curadoria vinculados. Uma decisão
clona o conjunto com novo ID, parent, sequência, ator e justificativa; nenhuma
revisão anterior é sobrescrita. As duas tabelas têm RLS forçada e nenhum acesso
direto para anon/authenticated/service_role. Apenas a RPC específica é executável
pelo backend. Advisory locks e revisão esperada serializam decisões; o mesmo ID
com corpo/ator diferentes é rejeitado. Falha de transporte não provoca retry
automático; o modal preserva a tentativa e oferece reconferência.

A revisão do conjunto exige outro Owner que não tenha preparado/vinculado o
agregado, curadorias atuais revisadas e nenhuma pendência de seção. Curadoria
vinculada fica visivelmente pendente se uma versão/fonte mudar. Quarentena do
conjunto continua possível após mudança de origem. Histórico e filtros paginados
ficam em modal na seção Documentos longos do Conhecimento EVA.

O gatilho `eva_document_parts_search_guard` impede a criação de releases do fluxo
atual para hashes de partes registrados. A preparação também rejeita hash que já
esteja em release existente. Assim esta entrega não altera releases anteriores
nem habilita publicação fragmentada como se fosse uma norma integral.
`readyForSearch` permanece sempre false, inclusive após revisão interna.

## Entrega e validação

- 153 testes Jest em sete suítes: preparação longa, extração anterior, conversa
  PR392, integração offline do chat, corpus, Search e execução de indexação.
- 172 verificações PostgreSQL descartáveis da nova migração: exatamente duas
  tabelas, ACL/RLS/RPC, invariantes, idempotência, decisões concorrentes,
  independência de Owner, vínculos, quarentena/revogação e bloqueio de Search.
  PGlite serializa sua conexão; o teste de decisões concorrentes não substitui
  ensaio multi-conexão em um servidor PostgreSQL real antes da migração compartilhada.
- 158 verificações SQL da extração anterior e 383 do corpus: preservadas.
- Teste DOM da nova tela, regressões DOM do chat e citações: aprovados.
- Builds Nest e Next aprovados. Nenhuma nova dependência ou alteração de lockfile.
- Normalizados separadores dos diretórios locais de fontes/cmaps/wasm no parser
  para manter funcionamento no Windows; os limites e o resultado não mudaram.

Sem migração compartilhada, habilitação, upload real, embeddings ou publicação
de normas nesta validação. Fixtures não comprovam o PDF regulatório real.
REN1000 recebida localmente permanece pendente de vigências, redações e anexos.
Calendário CCEE, publicação composta e recuperação de norma longa não estão nesta
entrega. O corpus e o RAG atuais, preços, reservas, licenças e flags foram preservados.

## Implantação posterior

1. Conferir main, diff e schema atuais; executar CI e ensaio multi-conexão de locks
   e migração no PostgreSQL descartável. Nenhuma migração antiga deve ser reaplicada.
2. Fazer dry-run da migração com auditoria de linhas/ACL/funções/triggers existentes.
   Somente após validar o relatório, aplicar a migração aditiva e implantar com
   `EVA_DOCUMENT_PARTS_ENABLED=false`.
3. Homologar primeiro com material sintético. Habilitação/gravações reais e
   processamento do original REN1000 exigem a delimitação da próxima fase.
4. Revisar vigência e redações/anexos, com páginas originais, antes de propor
   publicação composta no Search/RAG. Não aumentar os limites atuais silenciosamente.

Rollback operacional: manter a flag false, preservar as tabelas/histórico e usar
o fluxo anterior. Nenhum serviço Azure novo. Custos futuros de Blob, CPU Railway,
embeddings, Search e geração devem continuar separados no catálogo de custos para
Owner/Financeiro; dados sintéticos e estimativas não são despesas efetivas.
