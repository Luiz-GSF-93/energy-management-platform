import {MonthlyInputsService} from './monthly-inputs.service';
const unit='11111111-1111-4111-8111-111111111111';
function setup(origin='OCR_REVIEWED'){
 const service=new MonthlyInputsService({} as any,{} as any);jest.spyOn(service,'one').mockResolvedValue({status:'DRAFT',consumer_unit_id:unit,month:'2026-08',previous_id:null,origin} as any);const write=jest.spyOn(service as any,'write').mockResolvedValue({id:'input'});
 const dto:any={consumerUnitId:unit,month:'2026-08',revision:2,previousId:null,measurements:{consumptionTotal:'10',demandSingle:'234.64'},billedDemand:null,sourceReference:'Relatório de medição, página 1',notes:'',correctionReason:''};return {service,write,dto,t:{organizationId:'org',userId:'actor'} as any};
}
describe('Justified manual complements to OCR monthly drafts',()=>{
 it.each(['','  ','ab'])('rejects insufficient justification %j',async correctionReason=>{const s=setup();await expect(s.service.update('input',{...s.dto,correctionReason},s.t)).rejects.toThrow('justificativa');expect(s.write).not.toHaveBeenCalled();});
 it('records the evidence and actor through the existing revision write',async()=>{const s=setup();await s.service.update('input',{...s.dto,correctionReason:'Valor preciso conferido no relatório da competência, página 1.'},s.t);expect(s.write).toHaveBeenCalledWith('input',2,expect.objectContaining({updated_by:'actor',correction_reason:'Valor preciso conferido no relatório da competência, página 1.',measurements:expect.objectContaining({demandSingle:'234.64'})}),s.t);});
 it('preserves manual-origin workflow',async()=>{const s=setup('MANUAL');await s.service.update('input',s.dto,s.t);expect(s.write).toHaveBeenCalledTimes(1);});
 it('does not allow editing validated OCR values',async()=>{const s=setup();jest.spyOn(s.service,'one').mockResolvedValue({status:'VALIDATED',origin:'OCR_REVIEWED'} as any);await expect(s.service.update('input',{...s.dto,correctionReason:'Fonte conferida'},s.t)).rejects.toThrow('rascunho');expect(s.write).not.toHaveBeenCalled();});
});
