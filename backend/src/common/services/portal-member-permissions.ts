import {ForbiddenException} from '@nestjs/common';
import {PERMISSIONS as P} from '../constants/permissions';
import {PortalModule} from '../../modules/client-portal-licenses/portal-route-module';
// Portal RPCs retain their license/unit checks; a configured individual limit also
// narrows their corresponding module before the handler, including legacy RPC routes.
const required:Record<PortalModule,string>={reports:P.DOCUMENTS_REPORTS_VIEW,forecasts:P.ENERGIA_INDICATORS_VIEW,energy_prices:P.OPERACAO_PLD_VIEW,acl:P.ORGANIZATION_CONTRACTS_VIEW,documents:P.DOCUMENTS_VIEW,bot:P.INTELLIGENCE_AI_USE,agenda:P.OPERACAO_CALENDAR_VIEW,notifications:P.DOCUMENTS_REPORTS_VIEW,map:P.ORGANIZATION_CONSUMER_UNITS_VIEW,trading:P.ORGANIZATION_CONTRACTS_VIEW};
export function assertPortalMemberPermission(module:PortalModule|null,permissions:string[],configured:boolean){
 if(configured&&module&&!permissions.includes(required[module]))throw new ForbiddenException('Este recurso do Portal não foi autorizado nas permissões individuais.');
}
