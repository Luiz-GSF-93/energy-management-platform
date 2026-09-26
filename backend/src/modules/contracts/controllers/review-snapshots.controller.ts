import {Controller,Get,Post,Body,Param,Query,ParseUUIDPipe} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {ReviewSnapshotsService} from '../services/review-snapshots.service';
import {CreateReviewSnapshotDto,ReviewSnapshotQueryDto} from '../dto/review-snapshots.dto';
@Controller('calculation-review-snapshots')
export class ReviewSnapshotsController {
 constructor(private service:ReviewSnapshotsService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Query() q:ReviewSnapshotQueryDto,@Tenant() t:TenantContext){return this.service.list(q,t);}
 @Get(':id') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) one(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext){return this.service.one(id,t);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) create(@Body() d:CreateReviewSnapshotDto,@Tenant() t:TenantContext){return this.service.create(d,t);}
}
