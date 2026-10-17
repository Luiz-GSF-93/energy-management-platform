# Contexto da conversa do fechamento

`EVA_CLOSING_CONTEXT_ENABLED=false` por padrão. Requer as flags de conversa existentes; não habilita chamadas ou correções por si só. Sem migração ou novas tabelas. Entrega inicialmente desligada; publicar REN1000 não faz parte desta mudança.

Com a regra ligada, `POST /eva-assisted-closing/dialogue` aceita `memory?: string[]`: até oito perguntas de até 500 caracteres, no máximo 3.000 caracteres agregados. Chamadas antigas com `previousQuestion` continuam compatíveis. Não aceita respostas de assistente ou papéis enviados pelo cliente. Memória não autoriza mutações e não serve de fundamento financeiro/normativo. Somente a pergunta atual passa pelo parser de correções existente.

O frontend mantém até vinte pares e 60.000 caracteres de histórico na sessão, com aviso de descarte e expansão do painel; transmite apenas a memória curta. Fechamento/usuário/organização/permissões/unidade/competência trocados remontam o componente e descartam a memória. Nada é persistido no navegador. Respostas continuam texto seguro, sem HTML executável.

O backend relê a versão autorizada e o contexto da unidade pelo RPC existente `capture`, sujeito ao mesmo isolamento. Só projeta id, distribuidora, grupo/subgrupo/modalidade/classe, tensão, estado e indicador de mercado. Esses dados cadastrais atuais não reescrevem evidência histórica. Não deduz UF a partir do nome da unidade.

Perguntas independentes sobre economia não herdam a classificação normativa anterior. Referências curtas usam até duas perguntas recentes para recuperação. ACL/ACR explícitos prevalecem; na comparação são feitas no máximo duas recuperações, uma por mercado, deduplicando citações e provas; contexto desconhecido usa COMMON. Limites, vigência, publicação e licença do RAG permanecem. Provas conflitantes impedem resposta; provas são revalidadas em grupos compatíveis com o RPC antes da entrega.

Projeção financeira mantém totais consolidados identificados e valores da unidade separados. Detalhes são escolhidos por assunto: taxas, tarifas, honorários, comparação anterior, resumo; até 12.500 bytes de itens completos, com contagem de omissões. Evidências oficiais completas são selecionadas dentro de 43.000 bytes, com margem para envelope e estado da recuperação. Limites de 45.000/48.000 bytes preservados. Não há truncamento no meio de um artigo. Citações correspondem somente aos trechos enviados. Ausência/indisponibilidade normativa permite explicar valores registrados, com ressalva explícita, sem afirmar regra fiscal. Falta de autorização não é tratada como simples ausência de evidência.

Regras de ICMS exigem fonte tributária competente, jurisdição e aplicabilidade; REN1000 e procedimentos CCEE não substituem essa conferência. A biblioteca precisa concluir curadoria, revisão independente e publicação para disponibilizar seus documentos. Não é treinamento de pesos do modelo.

Custos continuam no ledger CHAT/RAG existente; explicações não debitam documentos. Correções mantêm prévia, confirmação explícita, débito único de documento, nova versão e decisão financeira humana separada. Nenhuma atualização financeira ocorre durante uma consulta.

Testes: contexto extenso com seis trechos, continuidade e mudança de assunto, ambas modalidades/UF desconhecida, fontes ausentes/indisponíveis, permissão revogada, versão alterada, histórico malicioso/limites, provas duplicadas, regressão das correções e painel expansível sem execução de HTML. Homologação paga requer autorização posterior delimitada.
