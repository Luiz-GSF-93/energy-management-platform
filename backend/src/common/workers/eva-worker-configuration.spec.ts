import {assertEvaWorkerConfiguration} from './eva-worker-configuration';
describe('private intake deployment dependencies',()=>{
 it.each([undefined,'false',''])('rejects active intake without financial preparation (%s)',value=>expect(()=>assertEvaWorkerConfiguration({EVA_AUTOMATIC_INTAKE_ENABLED:'true',CALCULATION_AUTOFILL_ENABLED:value})).toThrow('CALCULATION_AUTOFILL_ENABLED'));
 it('allows active intake with the API preparation setting',()=>expect(()=>assertEvaWorkerConfiguration({EVA_AUTOMATIC_INTAKE_ENABLED:'true',CALCULATION_AUTOFILL_ENABLED:'true'})).not.toThrow());
 it('does not require financial preparation for a worker without intake',()=>expect(()=>assertEvaWorkerConfiguration({})).not.toThrow());
 it('requires the same calculation engine for the manual preparation queue',()=>expect(()=>assertEvaWorkerConfiguration({EVA_MANUAL_PREPARATION_ASYNC_ENABLED:'true'})).toThrow('CALCULATION_AUTOFILL_ENABLED'));
 it('allows the private manual queue when calculations are configured',()=>expect(()=>assertEvaWorkerConfiguration({EVA_MANUAL_PREPARATION_ASYNC_ENABLED:'true',CALCULATION_AUTOFILL_ENABLED:'true'})).not.toThrow());
});
