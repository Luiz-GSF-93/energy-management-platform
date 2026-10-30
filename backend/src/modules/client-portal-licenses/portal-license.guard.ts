import {CanActivate,ExecutionContext,Injectable} from '@nestjs/common';
import {PortalLicenseService} from './portal-license.service';
import {portalRouteModule} from './portal-route-module';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
import {portalRequestScope} from '../../common/services/portal-customer-context';
import {assertPortalMemberPermission} from '../../common/services/portal-member-permissions';
@Injectable()
export class PortalLicenseGuard implements CanActivate {
 constructor(private licenses:PortalLicenseService){}
 async canActivate(context:ExecutionContext){
  const request=context.switchToHttp().getRequest<RequestWithTenant>();const tenant=request.tenantContext;
  if(!tenant||tenant.role!=='consulta'||tenant.accessMode)return true;
  const module=portalRouteModule(request.path,request.method);
  assertPortalMemberPermission(module,tenant.permissions,tenant.individualPermissions===true);
  if(!this.licenses.enabled())return true;
  if(module){if(tenant.portalCustomerScope)await portalRequestScope.run(tenant.portalCustomerScope,()=>this.licenses.client(tenant,module));else await this.licenses.client(tenant,module);}
  return true;
 }
}
