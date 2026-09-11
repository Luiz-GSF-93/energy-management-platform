import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SettlementEngine, SettlementInput } from '../settlement.engine';

describe('SettlementEngine', () => {
  let engine: SettlementEngine;
  
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SettlementEngine],
    }).compile();
    
    engine = module.get<SettlementEngine>(SettlementEngine);
  });
  
  describe('calculateSettlement - FIXED Model', () => {
    it('deve calcular apuração corretamente com modelo FIXED', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-001',
        referenceMonth: new Date('2026-01-01'),
        
        consumptionMwh: 100,
        regulatedEnergyPrice: 500,      // R$ 500/MWh
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        
        contractedPrice: 450,            // R$ 450/MWh
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        
        remunerationModel: 'FIXED',
        fixedFee: 1000,
      };
      
      const result = engine.calculateSettlement(input);
      
      // Cálculos:
      // regulatedTotalCost = (100 * 500) + 5000 + 2000 = 57000
      // aclTotalCost = (100 * 450) + 1000 + 500 + 800 = 47300
      // grossSavings = 57000 - 47300 = 9700
      // eligibleCosts = 9700 * 15% = 1455
      // netSavings = 9700 - 1455 = 8245
      // managementFee = 1000 (FIXED)
      // customerFinalSavings = 8245 - 1000 = 7245
      
      expect(result).toBeDefined();
      expect(result.regulatedTotalCost).toBe(57000);
      expect(result.aclTotalCost).toBe(47300);
      expect(result.grossSavings).toBe(9700);
      expect(result.eligibleCosts).toBe(1455);
      expect(result.netSavings).toBe(8245);
      expect(result.managementFee).toBe(1000);
      expect(result.customerFinalSavings).toBe(7245);
      expect(result.savingsPercentage).toBeCloseTo(17.02, 1);
    });
    
    it('deve incluir breakdown detalhado', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-002',
        referenceMonth: new Date('2026-01-01'),
        consumptionMwh: 100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        remunerationModel: 'FIXED',
        fixedFee: 1000,
      };
      
      const result = engine.calculateSettlement(input);
      
      expect(result.breakdown.regulatedEnergy).toBe(50000);
      expect(result.breakdown.aclEnergy).toBe(45000);
      expect(result.breakdown.regulatedTusd).toBe(5000);
      expect(result.breakdown.aclCcee).toBe(1000);
    });
  });
  
  describe('calculateSettlement - HYBRID Model', () => {
    it('deve calcular corretamente com modelo HYBRID', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-003',
        referenceMonth: new Date('2026-01-01'),
        
        consumptionMwh: 100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        
        remunerationModel: 'HYBRID',
        fixedFee: 500,
        variablePercentage: 25,
      };
      
      const result = engine.calculateSettlement(input);
      
      // netSavings = 8245
      // managementFee = 500 + (8245 * 25%) = 500 + 2061.25 = 2561.25
      // customerFinalSavings = 8245 - 2561.25 = 5683.75
      
      expect(result.managementFee).toBeCloseTo(2561.25, 1);
      expect(result.customerFinalSavings).toBeCloseTo(5683.75, 1);
    });
  });
  
  describe('calculateSettlement - PERFORMANCE Model', () => {
    it('deve calcular corretamente com modelo PERFORMANCE', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-004',
        referenceMonth: new Date('2026-01-01'),
        
        consumptionMwh: 100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        
        remunerationModel: 'PERFORMANCE',
        variablePercentage: 30,
      };
      
      const result = engine.calculateSettlement(input);
      
      // managementFee = 8245 * 30% = 2473.5
      // customerFinalSavings = 8245 - 2473.5 = 5771.5
      
      expect(result.managementFee).toBeCloseTo(2473.5, 1);
      expect(result.customerFinalSavings).toBeCloseTo(5771.5, 1);
    });
  });
  
  describe('Validação - Erros', () => {
    it('deve lançar erro com consumo negativo', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-005',
        referenceMonth: new Date('2026-01-01'),
        consumptionMwh: -100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        remunerationModel: 'FIXED',
        fixedFee: 1000,
      };
      
      expect(() => engine.calculateSettlement(input)).toThrow(BadRequestException);
    });
    
    it('deve lançar erro com consumo abaixo do mínimo', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-006',
        referenceMonth: new Date('2026-01-01'),
        consumptionMwh: 50,
        minConsumption: 100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        remunerationModel: 'FIXED',
        fixedFee: 1000,
      };
      
      expect(() => engine.calculateSettlement(input)).toThrow(BadRequestException);
    });
    
    it('deve lançar erro com percentual inválido', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-007',
        referenceMonth: new Date('2026-01-01'),
        consumptionMwh: 100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        remunerationModel: 'HYBRID',
        fixedFee: 500,
        variablePercentage: 150,
      };
      
      expect(() => engine.calculateSettlement(input)).toThrow(BadRequestException);
    });
  });
  
  describe('Casos Extremos', () => {
    it('deve retornar 0 para economia quando custos são iguais', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-008',
        referenceMonth: new Date('2026-01-01'),
        consumptionMwh: 100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        contractedPrice: 500,
        cceeCost: 5000,
        chargesCost: 0,
        taxesCost: 2000,
        remunerationModel: 'FIXED',
        fixedFee: 0,  // Permitir fixedFee = 0
      };
      
      const result = engine.calculateSettlement(input);
      
      expect(result.grossSavings).toBe(0);
      expect(result.customerFinalSavings).toBe(0);
    });
    
    it('deve calcular corretamente com consumo pequeno', () => {
      const input: SettlementInput = {
        consumerUnitId: 'uc-009',
        referenceMonth: new Date('2026-01-01'),
        consumptionMwh: 0.1,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        remunerationModel: 'FIXED',
        fixedFee: 100,
      };
      
      const result = engine.calculateSettlement(input);
      
      // regulatedTotalCost = (0.1 * 500) + 5000 + 2000 = 7050
      // aclTotalCost = (0.1 * 450) + 1000 + 500 + 800 = 2345
      // grossSavings = 7050 - 2345 = 4705
      
      expect(result.regulatedTotalCost).toBeCloseTo(7050, 1);
      expect(result.aclTotalCost).toBeCloseTo(2345, 1);
      expect(result.grossSavings).toBeCloseTo(4705, 1);
    });
  });
});
