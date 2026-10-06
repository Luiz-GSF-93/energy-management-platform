import {mapQuery} from './energy-map.validation';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {UpdateConsumerUnitDto} from '../consumer-units/dto/create-consumer-unit.dto';
describe('Independent energy classifications',()=>{
 it.each([[false,true,null],[true,true,false],[false,true,true]])('accepts market %s GD %s BESS %s',async(freeMarket,hasGd,hasBess)=>{
  expect(await validateWriteDto(UpdateConsumerUnitDto,{freeMarket,hasGd,hasBess})).toMatchObject({freeMarket,hasGd,hasBess});
 });
 it.each(['true',1,{},[]])('rejects coerced classification %p',async(hasGd)=>{await expect(validateWriteDto(UpdateConsumerUnitDto,{hasGd} as any)).rejects.toThrow();});
 it('filters independent attributes',()=>{expect(mapQuery({market:'ACR',gd:'YES',bess:'YES'})).toMatchObject({market:'ACR',gd:'YES',bess:'YES'});});
 it.each(['gd','bess'])('rejects invalid %s filter',key=>{expect(()=>mapQuery({[key]:'possibly'})).toThrow();});
});
