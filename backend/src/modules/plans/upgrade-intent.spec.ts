import {upgradeIntent} from './upgrade-intent';
describe('Commercial upgrade intent',()=>{
 test('legacy requests remain compatible and never grant entitlements',()=>{expect(upgradeIntent({note:' Mais usuários '})).toBe('Mais usuários');});
 test('documents and tickets record a positive exact quantity without a price',()=>{
  expect(upgradeIntent({note:'Ampliar capacidade',kind:'documents',quantity:100})).toContain('Documentos adicionais: 100');
  expect(upgradeIntent({note:'Ampliar capacidade',kind:'tickets',quantity:2})).toContain('não autoriza cobrança');
  for(const quantity of [-1,0,1.5,1000001,NaN])expect(()=>upgradeIntent({note:'Ampliar capacidade',kind:'documents',quantity})).toThrow();
 });
 test('unknown modules and mismatched fields cannot become commercial requests',()=>{
  expect(upgradeIntent({note:'Quero acesso',kind:'module',module:'client_portal'})).toContain('Portal do Cliente');
  for(const input of [{kind:'module',module:'__proto__'},{kind:'plan',quantity:3},{kind:'documents',quantity:3,module:'client_portal'},{kind:'unknown'}])expect(()=>upgradeIntent({note:'Quero acesso',...input})).toThrow();
 });
});
