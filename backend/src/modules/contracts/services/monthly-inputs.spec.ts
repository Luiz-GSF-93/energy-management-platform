import 'reflect-metadata';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {MonthlyInputDto} from '../dto/monthly-inputs.dto';
import {measurementIssues,normalizeMeasurements} from './monthly-inputs';
import {MonthlyInputsController} from '../controllers/monthly-inputs.controller';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {PERMISSIONS_KEY} from '../../../common/decorators/require-permission.decorator';
describe('monthly measurement normalization',()=>{
 it('preserves missing vs explicit zero',()=>{expect(normalizeMeasurements({consumptionTotal:'0'}).consumptionTotal).toBe('0');expect(normalizeMeasurements({}).consumptionTotal).toBeNull();});
 it('sums decimal measurements exactly',()=>expect(measurementIssues({consumptionTotal:'0.3',consumptionPeak:'0.1',consumptionOffPeak:'0.2'},true)).toEqual([]));
 it('detects a one-millionth discrepancy at high magnitude',()=>expect(measurementIssues({consumptionTotal:'999999999999.999999',consumptionPeak:'999999999999.999998',consumptionOffPeak:'0'},true)).toHaveLength(1));
 it('allows saving an incomplete draft but not validating',()=>{expect(measurementIssues({})).toEqual([]);expect(measurementIssues({},true)).toHaveLength(1);});
 it('does not silently fill a missing time band',()=>expect(measurementIssues({consumptionTotal:'1',consumptionPeak:'1'},true)).toHaveLength(1));
 it('accepts band measurements without inventing a total',()=>expect(measurementIssues({consumptionPeak:'0',consumptionOffPeak:'1'},true)).toEqual([]));
 it('rejects mixing single and time-band demand',()=>expect(measurementIssues({demandSingle:'0',demandPeak:'0'})).toHaveLength(1));
 it('keeps immutable normalization source',()=>{const m={consumptionTotal:'1.000000'};normalizeMeasurements(m);expect(m).toEqual({consumptionTotal:'1.000000'});});
 it.each(['-1','1e6','NaN','1,5','1.1234567','1000000000000','01'])('rejects malformed decimal %s',async v=>{await expect(validateWriteDto(MonthlyInputDto,{consumerUnitId:'00000000-0000-4000-8000-000000000001',month:'2026-09',measurements:{consumptionTotal:v},sourceReference:'Source',notes:'',correctionReason:''})).rejects.toMatchObject({status:400});});
 it.each([['list',P.ORGANIZATION_CONTRACTS_VIEW],['events',P.ORGANIZATION_CONTRACTS_VIEW],['create',P.ORGANIZATION_CONTRACTS_CREATE],['update',P.ORGANIZATION_CONTRACTS_UPDATE],['validate',P.ORGANIZATION_CONTRACTS_UPDATE]])('requires permissions for %s',(method,permission)=>expect(Reflect.getMetadata(PERMISSIONS_KEY,MonthlyInputsController.prototype[method as keyof MonthlyInputsController])).toEqual([permission]));
});
