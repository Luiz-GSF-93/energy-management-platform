import {Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req,UsePipes,ValidationPipe} from '@nestjs/common';
import {IsString,IsUUID,MaxLength,MinLength} from 'class-validator';
import {Transform} from 'class-transformer';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {TEAM_MANAGE} from './platform-team.permissions';
import {TeamPasswordService} from './team-password.service';
export class TeamPasswordDto{
 @IsUUID('4') requestKey!:string;
 @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @MinLength(20) @MaxLength(1000) reason!:string;
}
@Controller('admin/platform-team-password') @PlatformScope() @RequirePermission([TEAM_MANAGE])
@UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
export class TeamPasswordController{
 constructor(private readonly service:TeamPasswordService){}
 @Get(':user') @RequirePermission([TEAM_MANAGE]) read(@Req() req:RequestWithAuthenticatedUser,@Param('user',new ParseUUIDPipe()) user:string,@Query('page') page?:string){return this.service.read(req.authenticatedUser.userId,user,page===undefined?0:Number(page));}
 @Post(':user') @RequirePermission([TEAM_MANAGE]) send(@Req() req:RequestWithAuthenticatedUser,@Param('user',new ParseUUIDPipe()) user:string,@Body() dto:TeamPasswordDto){return this.service.send(req.authenticatedUser.userId,user,dto.requestKey,dto.reason);}
}
