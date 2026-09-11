import { Controller, Get, Post, Body, Param, Put, UseGuards } from '@nestjs/common';
import { UserManagementService } from '../services/user-management.service';
import { CreateUserDto, UpdateUserDto, AssignRoleDto } from '../dtos/create-user.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../auth/enums/role.enum';

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly userManagementService: UserManagementService) {}

  @Get()
  async getAllUsers() {
    return this.userManagementService.getAllUsers();
  }

  @Get(':id')
  async getUserById(@Param('id') id: string) {
    return this.userManagementService.getUserById(id);
  }

  @Get('role/:role')
  async getUsersByRole(@Param('role') role: string) {
    const validRole = role as UserRole;
    return this.userManagementService.getUsersByRole(validRole);
  }

  @Put(':id/profile')
  async updateUserProfile(
    @Param('id') id: string,
    @Body() updates: UpdateUserDto,
  ) {
    return this.userManagementService.updateUserProfile(id, updates);
  }

  @Put(':id/role')
  async assignRole(
    @Param('id') id: string,
    @Body() { role }: AssignRoleDto,
  ) {
    const validRole = role as UserRole;
    return this.userManagementService.updateUserRole(id, validRole);
  }

  @Put(':id/activate')
  async activateUser(@Param('id') id: string) {
    return this.userManagementService.activateUser(id);
  }

  @Put(':id/deactivate')
  async deactivateUser(@Param('id') id: string) {
    return this.userManagementService.deactivateUser(id);
  }

  @Get('analytics/overview')
  async getUsersAnalytics() {
    return this.userManagementService.getUsersAnalytics();
  }
}
