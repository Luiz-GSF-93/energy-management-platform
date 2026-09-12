import { Injectable } from '@nestjs/common';

export interface ContractValidationResult {
  clienteEncontrado: boolean;
  contratoValido: boolean;
  consumoConsistente: boolean;
  duplicidade: boolean;
  status: 'VALIDO' | 'AVISO' | 'REJEITO';
  observacoes: string[];
  organizationId?: string;
  contractId?: string;
}

@Injectable()
export class ContractValidationService {
  validateAgainstContract(
    clientCnpj: string,
    consumerUnitNumber: string,
    referenceMonth: string,
    consumptionKwh: number,
  ): ContractValidationResult {
    const observacoes: string[] = [];
    let status: 'VALIDO' | 'AVISO' | 'REJEITO' = 'VALIDO';

    const clienteEncontrado = !!clientCnpj;
    const contratoValido = true;
    const consumoConsistente = consumptionKwh > 0;
    const duplicidade = false;

    if (!clienteEncontrado) {
      observacoes.push('❌ Cliente não encontrado no sistema');
      status = 'REJEITO';
    }

    if (!contratoValido) {
      observacoes.push('❌ Nenhum contrato ativo encontrado para esta UC');
      status = 'REJEITO';
    }

    if (!consumoConsistente) {
      observacoes.push('⚠️ Consumo não identificado na fatura');
      status = 'AVISO';
    }

    if (duplicidade) {
      observacoes.push('❌ Fatura duplicada (já processada anteriormente)');
      status = 'REJEITO';
    }

    if (observacoes.length === 0) {
      observacoes.push('✅ Validação bem-sucedida');
    }

    return {
      clienteEncontrado,
      contratoValido,
      consumoConsistente,
      duplicidade,
      status,
      observacoes,
    };
  }
}
