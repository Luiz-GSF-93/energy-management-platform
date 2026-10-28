import {CanActivate,ExecutionContext,Injectable} from '@nestjs/common';
import {PortalLicenseService} from './portal-license.service';
import {portalRouteModule} from './portal-route-module';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
import {portalRequestScope} from '../../common/services/portal-customer-context';
@Injectable()
export class PortalLicenseGuard implements CanActivate {
 constructor(private licenses:PortalLicenseService){}
 async canActivate(context:ExecutionContext){
  if(!this.licenses.enabled())return true;
  const request=context.switchToHttp().getRequest<RequestWithTenant>();const tenant=request.tenantContext;
  if(!tenant||tenant.role!=='consulta'||tenant.accessMode)return true;
  const module=portalRouteModule(request.path,request.method);
  if(module){if(tenant.portalCustomerScope)await portalRequestScope.run(tenant.portalCustomerScope,()=>this.licenses.client(tenant,module));else await this.licenses.client(tenant,module);}
  return true;
 }
}
