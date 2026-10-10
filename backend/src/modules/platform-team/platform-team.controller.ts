import {Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Query,Req,UsePipes,ValidationPipe} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {PlatformTeamService} from './platform-team.service';
import {TEAM_MANAGE} from './platform-team.permissions';
import {InsertTeamDto,UpdateTeamDto} from './platform-team.dto';
function actor(req:RequestWithAuthenticatedUser){return {userId:req.authenticatedUser.userId,ip:req.ip,agent:req.get('user-agent')};}
@Controller('admin/platform-team') @PlatformScope()
@UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
export class PlatformTeamController{
 constructor(private readonly team:PlatformTeamService){}
 @Get() @RequirePermission([TEAM_MANAGE]) list(@Req() req:RequestWithAuthenticatedUser,@Query('page') page?:string){return this.team.list(actor(req),page===undefined?0:Number(page));}
 @Post() @RequirePermission([TEAM_MANAGE]) insert(@Req() req:RequestWithAuthenticatedUser,@Body() dto:InsertTeamDto){return this.team.insert(dto,actor(req));}
 @Patch(':id') @RequirePermission([TEAM_MANAGE]) update(@Req() req:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() dto:UpdateTeamDto){return this.team.save(id,dto,actor(req));}
}
