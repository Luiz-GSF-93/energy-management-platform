import 'reflect-metadata';
import {CceeController} from './ccee.controller';
import {PLATFORM_SCOPE_KEY} from '../../common/decorators/platform-scope.decorator';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {PUBLIC_KEY} from '../../common/decorators/public.decorator';
import {TEAM_MANAGE} from '../platform-team/platform-team.permissions';
describe('CCEE operation authorization',()=>{
 it('restricts publication to Owners while preserving publication validation',()=>expect(Reflect.getMetadata(PERMISSIONS_KEY,CceeController.prototype.publish)).toEqual([TEAM_MANAGE]));
 it('requires global platform context rather than customer organization context',()=>expect(Reflect.getMetadata(PLATFORM_SCOPE_KEY,CceeController)).toBe(true));
 it.each(['status','test','preview'] as const)('requires administrator permissions for %s',method=>{
  expect(Reflect.getMetadata(PERMISSIONS_KEY,CceeController.prototype[method])).toEqual([TEAM_MANAGE]);
  expect(Reflect.getMetadata(PUBLIC_KEY,CceeController.prototype[method])).not.toBe(true);
 });
});
