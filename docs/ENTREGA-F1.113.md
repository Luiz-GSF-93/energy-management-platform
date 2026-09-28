# F1.113 — Preparação automática dos custos OCR

A CIP importada como pendente bloqueava a validação dos custos mensais. Novas importações registram o valor final da operação com tratamento INCLUDED, sem nova incidência e sem presumir alíquota ou isenção a partir de células vazias.

Ao abrir Revisar e validar custos de origem OCR_CIP, o servidor confere novamente escopo, licença, cliente ativo, identidade, consumo, competência, reconciliação, confiança e referência do arquivo. Atualiza apenas o tratamento UNSPECIFIED da CIP original compatível. Valor, demais lançamentos e classificações explícitas permanecem preservados. Divergência exige correção específica.

A atualização usa revisão otimista, autor real, justificativa e os gatilhos de auditoria existentes. A confirmação utiliza a nova revisão e continua separada da preparação; não altera versões validadas nem publica apuração. Abertura da página permanece somente leitura.

Validação: testes de serviço para repetição, concorrência, permissões, fonte alterada, valor divergente e preservação; teste DOM para preparação, confirmação com nova revisão e erro sem aprovação. Sem migração de banco ou nova chamada ao Azure.
