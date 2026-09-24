import {validTaxId,normalizeTaxId} from './tax-id';
describe('Brazilian tax identifier checksum',()=>{
 it.each(['11.222.333/0001-81','11222333000181','529.982.247-25','12.ABC.345/01DE-35'])('accepts official-format valid identifier %s',value=>expect(validTaxId(value)).toBe(true));
 it.each(['11222333000180','52998224724','00000000000','11111111111111','11222333000181<script>','12ABC34501DE34','123'])('rejects malformed identifier %s',value=>expect(validTaxId(value)).toBe(false));
 it('normalizes punctuation and letters',()=>expect(normalizeTaxId('12.abc.345/01de-35')).toBe('12ABC34501DE35'));
});
