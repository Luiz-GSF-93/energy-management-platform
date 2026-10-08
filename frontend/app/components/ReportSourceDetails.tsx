'use client';

import { ReactNode, useId, useRef } from 'react';

/** Presentation of already-loaded evidence; no requests or business state. */
export default function ReportSourceDetails({title,children}:{title:string;children:ReactNode}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  return <div className="report-source-details">
    <button type="button" className="report-source-details__trigger" aria-label={'Ver fontes: '+title} aria-haspopup="dialog" onClick={()=>dialog.current?.showModal()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 6v1"/></svg>
      <span>Ver fontes</span>
    </button>
    <dialog ref={dialog} className="report-source-details__dialog" aria-labelledby={headingId}>
      <header className="report-source-details__heading"><div><p>Fontes da versão publicada</p><h3 id={headingId}>{title}</h3></div><button type="button" autoFocus aria-label="Fechar fontes" onClick={()=>dialog.current?.close()}>Fechar ×</button></header>
      <div className="report-source-details__body">{children}</div>
    </dialog>
    <div className="report-source-details__print">{children}</div>
  </div>;
}
