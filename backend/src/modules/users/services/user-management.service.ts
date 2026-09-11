import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/enums/role.enum';

@Injectable()
export class UserManagementService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async getAllUsers(): Promise<User[]> {
    return this.userRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return user;
  }

  async getUsersByRole(role: UserRole): Promise<User[]> {
    return this.userRepository.find({
      where: { role },
      order: { createdAt: 'DESC' },
    });
  }

  async updateUserRole(userId: string, newRole: UserRole): Promise<User> {
    const user = await this.getUserById(userId);
    user.role = newRole;
    return this.userRepository.save(user);
  }

  async updateUserProfile(userId: string, updates: any): Promise<User> {
    const user = await this.getUserById(userId);
    Object.assign(user, updates);
    return this.userRepository.save(user);
  }

  async deactivateUser(userId: string): Promise<User> {
    const user = await this.getUserById(userId);
    user.isActive = false;
    return this.userRepository.save(user);
  }

  async activateUser(userId: string): Promise<User> {
    const user = await this.getUserById(userId);
    user.isActive = true;
    return this.userRepository.save(user);
  }

  async getUsersAnalytics(): Promise<any> {
    const users = await this.userRepository.find();

    return {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.isActive).length,
      inactiveUsers: users.filter((u) => !u.isActive).length,
      byRole: {
        admins: users.filter((u) => u.role === UserRole.ADMIN).length,
        backofficeManagers: users.filter((u) => u.role === UserRole.BACKOFFICE_MANAGER).length,
        backofficeAnalysts: users.filter((u) => u.role === UserRole.BACKOFFICE_ANALYST).length,
        clients: users.filter((u) => u.role === UserRole.CLIENT).length,
        support: users.filter((u) => u.role === UserRole.SUPPORT).length,
      },
    };
  }
}
