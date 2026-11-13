import {ConflictException,ServiceUnavailableException} from '@nestjs/common';

// Fixed product messages only: never expose SQL, source content or provider errors.
export function intakeReconciliationError(error:{code?:string;message?:string}){
 if(['55P03','57014'].includes(error.code??''))return new ConflictException({code:'EVA_PREPARATION_BUSY',message:'A conferência não conseguiu obter acesso à competência no prazo. A leitura foi preservada. O andamento será atualizado; aguarde a preparação em curso, sem reenviar o arquivo.',retryable:false});
 if(['PT409','40001','23505'].includes(error.code??'')){
  const financial=error.message==='Financial effects require separate reconciliation';
  const source=error.message==='Source changed';
  return new ConflictException({
   code:financial?'EVA_FINANCIAL_RECEIPT_REVIEW_REQUIRED':source?'EVA_SOURCE_RECHECK_REQUIRED':'EVA_PREPARATION_RECHECK_REQUIRED',
   message:financial?'A leitura está preservada. Uma gravação anterior do preenchimento exige reconciliação técnica antes da retomada. Não reenvie o arquivo: isso não resolve o recibo pendente.':source?'A leitura está preservada, mas uma fonte mudou. Atualize o andamento e confira a proposta antes de continuar; não reenvie o arquivo.':'A leitura está preservada. O protocolo mudou ou ainda exige conferência técnica. O andamento será atualizado; abrir a proposta permite conferir as pendências, sem repetir OCR ou aprovar valores.',
   retryable:false,
  });
 }
 return new ServiceUnavailableException({code:'EVA_INTAKE_RECONCILIATION_UNCONFIRMED',message:'A resposta da retomada não foi confirmada. Consulte o andamento atualizado antes de tentar novamente. A leitura e o original permanecem preservados; não reenvie o arquivo.'});
}
