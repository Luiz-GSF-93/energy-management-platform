'use client';
import {useState} from 'react';
import {Button,Card} from '@/app/components/ui';
import type {Result} from './CalculationPreparation';
import {correctionTarget,type CorrectionContext} from './preparation-navigation';
const guidance:Record<string,string>={
 supply:'Confira as condições já cadastradas, a compra do mês e a conciliação. Se faltar a nota, use a justificativa auditada disponível no cadastro. Uma diferença de volume precisa ter seu efeito financeiro esclarecido.',
 monthly:'Consulte a versão existente antes de alterar. Se os dados já estão validados, resolva a dependência indicada; não é necessário cadastrá-los novamente.',
 costs:'Revise os lançamentos da competência e o tratamento tributário. Corrija a versão existente pelo fluxo de revisão, preservando os valores que já estão corretos.',
 parameters:'Abra o parâmetro indicado e confira vigência, base e tratamento tributário. Uma alteração em registro aprovado deve gerar revisão.',
 management:'Confira o vínculo da unidade, a vigência e as condições dos honorários.',
 distributor:'Confira o enquadramento e os dados da unidade selecionada.'
};
export default function PendingResolution({result,customerId,onCorrect,onRefresh,busy}:{result:Result;customerId:string;onCorrect?:(c:CorrectionContext)=>void;onRefresh:()=>void;busy:boolean}){
 const [reviews,setReviews]=useState(false);
 const blockers=result.findings.filter(f=>f.severity==='BLOCKER');
 const warnings=result.findings.filter(f=>f.severity!=='BLOCKER');
 const visible=reviews?warnings:blockers;
 const base={customerId,unitId:result.unit.id,month:result.month};
 return <Card title="Resolver pendências"><p><strong>{result.unit.name} · {result.month}</strong></p><p>Abra uma correção por vez. Os dados existentes são carregados no cadastro; ao voltar, o diagnóstico consulta novamente esta unidade e este mês.</p>
 <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Button variant={!reviews?'primary':'secondary'} aria-pressed={!reviews} onClick={()=>setReviews(false)}>Pendências ({blockers.length})</Button><Button variant={reviews?'primary':'secondary'} aria-pressed={reviews} onClick={()=>setReviews(true)}>Pontos de revisão ({warnings.length})</Button><Button variant="secondary" disabled={busy} onClick={onRefresh}>Atualizar diagnóstico</Button></div>
 <div style={{display:'grid',gap:12,marginTop:16}}>{visible.length?visible.map((finding,i)=>{const target=correctionTarget(finding,base);return <article key={finding.code+'-'+i} className="ds-card"><h3>{finding.section}</h3><p><strong>{reviews?'Conferir:':'O que falta:'}</strong> {finding.message}</p>{target&&<p>{guidance[target.tab||'']||'Confira o registro e a fonte indicados nesta pendência.'}</p>}{onCorrect&&target?<Button onClick={()=>onCorrect({...target,message:finding.message})}>Resolver · {finding.section}</Button>:<p>Consulte as memórias e fontes abaixo para verificar esta ocorrência.</p>}</article>}):<p role="status">{reviews?'Nenhum ponto de revisão nesta consulta.':'Nenhuma pendência cadastral nesta consulta. Confira também os pontos de revisão e o resultado financeiro.'}</p>}</div>
 <details style={{marginTop:16}}><summary>O que já está cadastrado nesta competência</summary><p>Dados mensais: {result.measurements?.validatedVersion?'versão '+result.measurements.validatedVersion.version+' validada. Uma dependência financeira não exige recadastrar medições.':'sem versão validada nesta consulta.'}</p><p>Custos mensais: {result.costs?.validatedVersion?'versão '+result.costs.validatedVersion.version+' validada.':'sem versão validada nesta consulta.'}</p><p>{result.counts.approvedParameters} parâmetros aprovados · {result.counts.draftParameters} rascunhos.</p>{result.suppliers.map(s=><p key={s.id}>Fornecedor: contrato {s.number} · {s.start} a {s.end}.</p>)}</details>
 <p><small>Abrir uma correção não aprova registros. Salvar rascunho, validar e aprovar continuam seguindo as permissões e o histórico de cada cadastro.</small></p></Card>;
}
