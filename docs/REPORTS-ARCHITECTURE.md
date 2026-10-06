# Relatórios operacionais, executivos e recorrência

Solicitação de 06/10/2026. Integração incremental sobre o motor financeiro publicado, RBAC, licença, auditoria e cadastro existentes. Nenhuma reescrita da autenticação ou do motor.

## Etapas sequenciais

1. Contatos adicionais do cliente com nome, departamento, e-mail, telefone internacional, ativo e canais autorizados; edição auditada e versão otimista. Compatibilidade com contato principal atual. Vocabulário de interface e Bot-Energy: Expert/Consultor.
2. Menu Relatórios: Operacional, Executivo e Configurações. Snapshot versionado baseado exclusivamente nas apurações publicadas; exportação PDF/Excel com cabeçalho, período, contexto, cobertura, fontes e ressalvas. Não inventar consumo, CCEE, ROI, projeção ou desperdício sem evidência.
3. Políticas de recorrência mensal/quinzenal, dias, horário de São Paulo, limite de envios, tipos/formatos, unidades e contatos selecionados do cliente. Fila persistente, idempotência, bloqueio por licença/permissão/cliente/contato, revisão de mudança de destino e histórico. Configurações não ativadas automaticamente.
4. Adaptadores de e-mail, WhatsApp e SMS; erros/estado desconhecido não equivalem a entrega. Provedores pendentes impedem envio nesse canal. Downloads e links exigem autorização; não publicar arquivos financeiros em buckets públicos nem inferir acesso ao portal a partir de um contato.

## Modelo e permissões

Contatos adicionais em customers.report_contacts (JSONB validado, limite 50, UUID estável). Histórico em registration_edits existente; organization_id do contexto autenticado. Relatórios e políticas futuras têm organization_id, customer_id e consumer_unit_id com validação de vínculo; snapshot imutável e identificação das fontes publicadas. Destinatários referenciados por ID, nunca por e-mail livre em configuração.

Cadastros: permissões existentes customers.view/create/update. Consulta/geração: reports.view/create e contracts.view, perfil interno autorizado e licença vigente. Configuração exige reports.create e notifications.manage. Administrador da plataforma opera mediante sessão explícita de organização; nenhuma consulta global financeira implícita. Cliente somente acessa material publicado dentro de seu vínculo exclusivo existente.

## Integração, testes e riscos

Reutilizar FinancialSettlementsService.reports/published, projeções/indicadores oficiais e eventos publicados. Sem motor financeiro paralelo no frontend. Migrações aditivas com guardas de definição e rollback transacional; histórico mantido. Testes em cada etapa: escopo A/B, permissão/licença, versões concorrentes, fonte publicada/integridade, calendário, duplicidade, mudanças de destinatário, sanitização e exportação; builds e regressões antes do checkpoint seguinte.

Custos CCEE dependem da integração real e de publicação. Quinzenal deve distinguir período de dados da frequência de envio: apurações mensais não serão artificialmente divididas em metades. Ausências são explicitamente indisponíveis. ROI precisa de investimento comprovado; projeções exigem metodologia publicada e identificação de estimativa. SMS depende de provedor. Nenhum envio real a clientes é feito durante testes sem destinatários específicos autorizados.

SMS confirmado pelo usuário: somente aviso genérico de relatório enviado ao e-mail, sem valores nem anexos; depende de aceite do e-mail pelo provedor e de provedor SMS ainda não contratado. Aceite não comprova entrega na caixa postal.

## Etapa 2 — recortes preservados e formatos

`published_report_snapshots` guarda um recorte de uma unidade/cliente por até 12 meses, tipo, contexto de cadastro na geração, fontes publicadas e SHA-256 canônico. RLS sem acesso anônimo ou direto pelo navegador; RPCs privadas do backend revalidam organização, vínculo ativo, perfil, permissões e capacidades `report_generation` e `free_market_management`. Versões são imutáveis; nova geração não altera as apurações nem as versões anteriores. Requisições repetidas pelo mesmo ator/recorte retornam a versão existente.

O menu Operacional/Executivo e os downloads autenticados usam o mesmo corpo preservado. PDFKit e ExcelJS são dependências de runtime do produto, fixadas em 0.20.2/4.4.0. XLSX real com consumo decimal exato e fontes monetárias exatas em texto; valores monetários utilizáveis como números somente quando seguros para a precisão do Excel. Nenhuma fórmula importada, macro, nota interna ou diretório de contatos é incluído. O módulo escreve arquivos; não recebe planilhas de terceiros nem usa leitura de arquivos do usuário em bibliotecas de arquivo/ZIP. PDFs verificados com fixtures sintéticas, renderização Poppler e inspeção visual; rodapés não criam páginas adicionais.

Eventos incluídos apenas quando publicados para a unidade no recorte e quando o ator tem permissão de consulta de eventos. Ausência de alertas não comprova ausência de desperdício. ROI, projeções e componentes CCEE permanecem explicitamente indisponíveis sem fonte/metodologia publicada. `Configurações` e envios recorrentes pertencem à etapa seguinte e não são apresentados como concluídos nesta etapa.
