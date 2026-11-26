/** Public, repository-reviewed content only. Never read tenant/customer APIs here. */
const publicTrainingVideo: string | null = null;

export default function LoginInstitutionalPanel() {
  const localVideo = publicTrainingVideo && /^\/media\/login\/[a-z0-9_-]+\.(mp4|webm)$/.test(publicTrainingVideo)
    ? publicTrainingVideo : null;
  return (
    <aside className="login-institutional" aria-labelledby="login-institutional-title">
      <div className="login-institutional__glow" aria-hidden="true" />
      <div className="login-institutional__content">
        <span className="login-institutional__eyebrow">GESTÃO DE ENERGIA COM INTELIGÊNCIA</span>
        <h2 id="login-institutional-title">Mais contexto.<br /><em>Melhores decisões.</em></h2>
        <p className="login-institutional__intro">Documentos, contratos e informações de energia conectados para acompanhar sua operação com a EVA.</p>
        <div className="login-institutional__visual" aria-hidden="true">
          <svg viewBox="0 0 520 170" focusable="false">
            <defs><linearGradient id="login-energy-line" x1="0" x2="1"><stop stopColor="#00c9f2"/><stop offset="1" stopColor="#00d995"/></linearGradient></defs>
            <path className="login-institutional__grid" d="M10 30H510M10 75H510M10 120H510M80 10V160M180 10V160M280 10V160M380 10V160M480 10V160"/>
            <path className="login-institutional__curve" d="M12 133L65 121L112 128L164 92L213 104L264 65L310 79L359 43L408 57L458 26L508 18"/>
            <circle cx="359" cy="43" r="6" fill="#00d995"/><circle cx="508" cy="18" r="6" fill="#00c9f2"/>
          </svg>
          <span>INFORMAÇÃO CONECTADA À SUA OPERAÇÃO</span>
        </div>
        <section className="login-institutional__news" aria-labelledby="login-news-title">
          <p className="login-institutional__eyebrow" id="login-news-title">NO SEU ENERGYOS</p>
          <div className="login-institutional__features">
            <article><span aria-hidden="true">01</span><h3>Documentos e EVA</h3><p>Leitura de faturas e notas em PDF ou XML, com fontes preservadas para conferência.</p></article>
            <article><span aria-hidden="true">02</span><h3>Mercado Livre de Energia</h3><p>Gestão do Mercado Livre e Adesão ACL, com seus contratos e unidades no contexto certo.</p></article>
            <article><span aria-hidden="true">03</span><h3>Portal do Cliente</h3><p>Acompanhamento das informações disponibilizadas pela organização responsável.</p></article>
          </div>
        </section>
        <section className="login-institutional__learn" aria-label="Orientações e treinamento">
          {localVideo ? <video controls preload="none" playsInline src={localVideo} aria-label="Treinamento público do EnergyOS" /> : (
            <details><summary>Primeiros passos com o EnergyOS</summary><p>Entre com seu perfil, selecione o ambiente autorizado e acompanhe as orientações da EVA. Confira as fontes antes de validar; a aprovação segue as permissões da organização.</p></details>
          )}
        </section>
        <a className="login-institutional__link" href="https://www.energy-os.app.br/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Conheça o EnergyOS para sua operação</a>
        <p className="login-institutional__privacy">Conteúdo institucional público. As informações da sua organização ficam no ambiente autenticado.</p>
      </div>
    </aside>
  );
}
