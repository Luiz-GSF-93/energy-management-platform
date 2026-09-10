import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './services/invoices.service';
import { SupabaseService } from '../../services/supabase.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let supabaseService: SupabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    supabaseService = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('simulateRegulatedMarket', () => {
    it('should calculate energy cost correctly', async () => {
      const dto = {
        consumerUnitId: 'unit-001',
        referenceMonth: '2026-09-01',
        consumptionKwh: 1000,
        demandKw: 10,
        peakRate: 0.80,
        offPeakRate: 0.50,
        demandRate: 15.00,
        pisPercentage: 0.0765,
        cofinsPercentage: 0.076,
        icmsPercentage: 0.18,
        tusdPercentage: 0.15,
        tePercentage: 0.12,
      };

      const result = await service.simulateRegulatedMarket(dto);

      expect(result.consumptionKwh).toBe(1000);
      expect(result.energyCostCalculated).toBeGreaterThan(0);
      expect(result.totalEstimated).toBeGreaterThan(result.subtotalBeforeTaxes);
    });

    it('should apply charges correctly', async () => {
      const dto = {
        consumerUnitId: 'unit-002',
        referenceMonth: '2026-09-01',
        consumptionKwh: 500,
        demandKw: 5,
        peakRate: 0.75,
        offPeakRate: 0.45,
        demandRate: 12.00,
        pisPercentage: 0.0765,
        cofinsPercentage: 0.076,
        icmsPercentage: 0.18,
        tusdPercentage: 0.15,
        tePercentage: 0.12,
      };

      const result = await service.simulateRegulatedMarket(dto);

      const expectedCharges = result.subtotalBeforeTaxes * 
        (dto.pisPercentage + dto.cofinsPercentage + dto.icmsPercentage + 
         dto.tusdPercentage + dto.tePercentage);

      expect(result.chargesTotal).toBeCloseTo(expectedCharges, 2);
    });

    it('should handle zero consumption', async () => {
      const dto = {
        consumerUnitId: 'unit-003',
        referenceMonth: '2026-09-01',
        consumptionKwh: 0,
        demandKw: 0,
        peakRate: 0.80,
        offPeakRate: 0.50,
        demandRate: 15.00,
        pisPercentage: 0.0765,
        cofinsPercentage: 0.076,
        icmsPercentage: 0.18,
        tusdPercentage: 0.15,
        tePercentage: 0.12,
      };

      const result = await service.simulateRegulatedMarket(dto);

      expect(result.energyCostCalculated).toBe(0);
      expect(result.demandCostCalculated).toBe(0);
    });

    it('should calculate total correctly', async () => {
      const dto = {
        consumerUnitId: 'unit-004',
        referenceMonth: '2026-09-01',
        consumptionKwh: 2000,
        demandKw: 20,
        peakRate: 0.85,
        offPeakRate: 0.55,
        demandRate: 18.00,
        pisPercentage: 0.0765,
        cofinsPercentage: 0.076,
        icmsPercentage: 0.18,
        tusdPercentage: 0.15,
        tePercentage: 0.12,
      };

      const result = await service.simulateRegulatedMarket(dto);

      const expectedTotal = result.subtotalBeforeTaxes + result.chargesTotal;
      expect(result.totalEstimated).toBeCloseTo(expectedTotal, 2);
    });
  });

  describe('createInvoice', () => {
    it('should calculate invoice totals correctly', async () => {
      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'inv-001',
              organization_id: 'org-001',
              consumer_unit_id: 'unit-001',
              energy_contract_id: 'contract-001',
              invoice_number: 'INV-001',
              issue_date: '2026-09-01T00:00:00Z',
              due_date: '2026-09-15T00:00:00Z',
              reference_month: '2026-09-01T00:00:00Z',
              status: 'draft',
              invoice_type: 'regulated',
              consumption_kwh: 1000,
              demand_kw: null,
              energy_tariff: 0.80,
              demand_tariff: null,
              energy_cost: 800,
              demand_cost: null,
              distribution_cost: 150,
              transmission_cost: 100,
              pis: 70,
              cofins: 68,
              icms: 160,
              tusd: 135,
              te: 108,
              subtotal: 1050,
              taxes: 298,
              total_amount: 1348,
              paid_amount: null,
              paid_date: null,
              invoice_url: null,
              notes: null,
              created_at: '2026-09-01T00:00:00Z',
              updated_at: '2026-09-01T00:00:00Z',
              created_by: 'user-001',
            },
          }),
        }),
      });

      (supabaseService.getClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          insert: mockInsert,
        }),
      });

      const dto = {
        organizationId: 'org-001',
        consumerUnitId: 'unit-001',
        energyContractId: 'contract-001',
        invoiceNumber: 'INV-001',
        issueDate: '2026-09-01',
        dueDate: '2026-09-15',
        referenceMonth: '2026-09-01',
        invoiceType: 'regulated' as const,
        consumptionKwh: 1000,
        energyTariff: 0.80,
        distributionCost: 150,
        transmissionCost: 100,
        pis: 70,
        cofins: 68,
        icms: 160,
        tusd: 135,
        te: 108,
      };

      const result = await service.createInvoice(dto, 'user-001');

      expect(result.totalAmount).toBe(1348);
      expect(result.subtotal).toBe(1050);
      expect(result.taxes).toBe(298);
    });
  });
});
