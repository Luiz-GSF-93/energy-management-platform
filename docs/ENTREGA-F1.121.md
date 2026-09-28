# F1.121 — Nota fiscal no cadastro do fornecedor

O formulário de contrato permite anexar uma nota opcional e informar sua competência. O cadastro é salvo primeiro; o arquivo usa o endpoint privado de Documentos com organização autenticada, cliente, unidade e energyContractId. O painel Notas fiscais / enviar arquivo permite consultar e enviar notas posteriormente.

Notas já existentes da mesma unidade e vigência, sem contrato associado, aparecem identificadas como sem vínculo. Não são vinculadas nem reenviadas automaticamente. Notas associadas a outro contrato não aparecem neste painel. A associação de arquivos antigos exige etapa auditada própria, não incluída nesta entrega.

O backend verifica que notas vinculadas pertencem a contrato de compra da mesma organização/cliente/unidade e competência dentro da vigência. Permanecem os controles existentes de permissão, licença, hash único, inspeção de conteúdo, limite de 10 MB, armazenamento privado, autor autenticado e URL temporária. Upload não aprova conteúdo, custos, OCR ou apuração.

Falha do upload após salvar o contrato é apresentada explicitamente; o contrato permanece e o painel permite reenviar só o arquivo. Testes cobrem esse estado para impedir criação duplicada do cadastro.

Validação: builds backend/frontend; 73 testes de documentos (arquivo, permissões, licença, escopo e vigência); 14 verificações DOM do anexo e recuperação; 17 verificações de regressão do faturamento. Sem migração adicional.
