import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from '../services/contracts.service';
import { ContractRepository } from '../repositories/contract.repository';

describe('ContractsService', () => {
  let service: ContractsService;
  let repository: ContractRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        ContractRepository,
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    repository = module.get<ContractRepository>(ContractRepository);
  });

  describe('create', () => {
    it('should create a new contract', async () => {
      const createDto = {
        contractNumber: 'CT-001',
        contractTitle: 'Contrato Padrão',
        monthlyFee: 1000,
        commissionPercentage: 5.5,
        startDate: '2026-09-11',
        contractType: 'STANDARD',
      };

      const result = await service.create(createDto, 'tenant_default');
      expect(result).toBeDefined();
      expect(result.contractNumber).toBe('CT-001');
      expect(result.status).toBe('ACTIVE');
    });

    it('should throw error for invalid monthly fee', async () => {
      const createDto = {
        contractNumber: 'CT-002',
        contractTitle: 'Contrato Inválido',
        monthlyFee: -100,
        commissionPercentage: 5,
        startDate: '2026-09-11',
        contractType: 'STANDARD',
      };

      try {
        await service.create(createDto, 'tenant_default');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('findAll', () => {
    it('should return all contracts', async () => {
      const contracts = await service.findAll();
      expect(Array.isArray(contracts)).toBe(true);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics overview', async () => {
      const analytics = await service.getAnalytics();
      expect(analytics).toBeDefined();
      expect(analytics).toHaveProperty('total');
      expect(analytics).toHaveProperty('active');
      expect(analytics).toHaveProperty('inactive');
    });
  });
});
