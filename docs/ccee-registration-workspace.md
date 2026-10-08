# Registros CCEE — módulo avulso

O catálogo e a licença possuem a capacidade independente `ccee_registrations`, inicialmente desabilitada. Não deriva de `free_market_management`, não altera licenças vigentes e não inclui preço comercial presumido. O administrador da plataforma seleciona a disponibilidade no plano e a contratação na licença, com versão, snapshot e auditoria existentes. Permissões de consultar, preparar e revisar são próprias e não são concedidas a papéis automaticamente.

## Viabilidade técnica confirmada

O [Manual oficial de contratos livres](https://www.ccee.org.br/documents/80415/919484/Manual%20servi%C3%A7os%20contratos.pdf/5a036b58-6e74-d2d5-acb3-d5fc8e96dc05) documenta `ImportarArquivoBSv1` para registro e validação, `ResultadoProcessamentoBSv1` para acompanhamento e `ContratoBSv2` para consulta. Vendedores registram os contratos; compradores validam os montantes. Operações limitam-se a perfis próprios ou representados. Não é uma API genérica que conclui automaticamente todas as obrigações mensais.

Os [eventos oficiais](https://github.com/devccee/webhook) diferenciam contrato registrado, contrato validado e montante ajustado. Aceitação da requisição, processamento, validação da contraparte e fechamento da competência são estados distintos.

## Escopo entregue

Menu organização `/backoffice/ccee-registrations`: registros de preparação por cliente, unidade, competência, operação, prazo, referência documental e agenda opcional. Agenda exige permissão própria e vínculo ao mesmo cliente/unidade; seu prazo é preservado. Modal de edição, revisão independente e consulta de auditoria. Estados internos DRAFT → REVIEW → APPROVED, devolução ao rascunho ou cancelamento. Nenhum desses estados declara registro/validação pela CCEE.

Backend e RPC conferem plano, vínculo backoffice e permissões; organização vem da sessão. Dados de clientes e unidades usam chaves compostas. Registros vinculados à agenda respeitam também o acesso ACL daquela agenda. Tabelas têm RLS, nenhum acesso direto autenticado ou service_role, RPCs apenas no backend, limite de leitura, controle de revisão, idempotência e histórico imutável. Registros aprovados não são reescritos. Autor/último editor não pode aprovar; prazo e agenda devem continuar válidos.

## Próxima homologação de transmissão

Não existe rota de envio remota nesta entrega; o botão está desabilitado. Para habilitar uma operação será necessário confirmar o leiaute oficial atual, ambiente piloto, perfil/representação por cliente/unidade, campos contratuais exigidos, papel comprador/vendedor, aprovação do arquivo exato, idempotência de protocolo e recuperação de resultado incerto sem repetição automática. Credencial global do perfil 80021 não comprova representação de todas as unidades.

Os serviços pertencem exclusivamente à camada CCEE Integration Service; Normalizer/Validation verificam retornos e vínculos antes do motor existente. Recebimento de protocolo não publica resultado econômico nem confirma fechamento. Agenda oficial e avisos externos dependem da integração e configurações específicas, sem inferir prazos universais ou efetuar SMS/WhatsApp a partir destes rascunhos.

## Conferência de requisitos (08/10/2026)

`GET /api/v1/ccee-registrations/:id/readiness` retorna a revisão do registro, data de conferência e pendências calculadas no backend. RPC de leitura exige a mesma licença, organização e permissões do workspace, preserva a visibilidade da agenda e consulta somente a última evidência da mesma organização/cliente/unidade. Evidência revogada ou substituída por rascunho não recupera uma aprovação anterior. Conteúdo documental e chaves não são retornados. Não há gravação nem consulta remota nessa conferência.

O modal distingue vínculo cadastral, revisão interna, prazo, agenda, evidência documental, representação/papel CCEE, leiaute, homologação piloto e aprovação do arquivo exato. Os quatro últimos itens permanecem pendentes enquanto não houver adaptador e prova homologados. Nenhuma variável de ambiente nem estado enviado pelo usuário pode habilitar transmissão por esse endpoint. Informar prazo manualmente mantém a agenda pendente de conferência oficial.

A seleção de um cliente piloto não confirma automaticamente seu código de perfil ou representação. Identificador da empresa, código de atendimento e código do representante são dados distintos. Confirmar o perfil na fonte autoritativa e preservar a evidência na organização; não versionar documentos ou dados do piloto no repositório.

O [guia oficial de primeiros passos](https://github.com/devccee/guia-primeiros-passos) distingue autenticação e autorização e informa a utilização do ambiente piloto. O [manual Importar Arquivo](https://www.ccee.org.br/documents/80415/919484/ImportarContratoArquivo_v1.5.pdf/4fbf3130-6e72-a235-8915-2ed56dac03a9) exige arquivo do gerador e WSDL/XSD correspondentes. O [manual Resultado Processamento](https://www.ccee.org.br/documents/80415/919484/Manual_ResultadoProcessamento_v1.5.pdf/490f3103-c729-fe92-bc78-e6dc70aa1872) documenta o processamento assíncrono. Os manuais consultados não constituem validação do XSD vigente ou do arquivo do piloto.
