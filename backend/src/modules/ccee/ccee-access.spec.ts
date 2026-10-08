import 'reflect-metadata';
import {CceeController} from './ccee.controller';
import {PLATFORM_SCOPE_KEY} from '../../common/decorators/platform-scope.decorator';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {PUBLIC_KEY} from '../../common/decorators/public.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('CCEE operation authorization',()=>{
 it('requires separate write authorization to publish reviewed PLD',()=>expect(Reflect.getMetadata(PERMISSIONS_KEY,CceeController.prototype.publish)).toEqual([P.PLATFORM_ORGANIZATIONS_UPDATE]));
 it('requires global platform context rather than customer organization context',()=>expect(Reflect.getMetadata(PLATFORM_SCOPE_KEY,CceeController)).toBe(true));
 it.each(['status','test','preview'] as const)('requires administrator permissions for %s',method=>{
  expect(Reflect.getMetadata(PERMISSIONS_KEY,CceeController.prototype[method])).toEqual([P.PLATFORM_ORGANIZATIONS_VIEW]);
  expect(Reflect.getMetadata(PUBLIC_KEY,CceeController.prototype[method])).not.toBe(true);
 });
});
