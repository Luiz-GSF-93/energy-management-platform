import { Injectable, Logger } from '@nestjs/common';
import { UserRepository, User } from '../repositories/user.repository';

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(private readonly userRepository: UserRepository) {}

  async create(dto: Partial<User>): Promise<User> {
    this.logger.log('Creating new user: ' + dto.email);
    return this.userRepository.create(dto);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.findAll();
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new Error('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email);
  }

  async findByRole(role: string): Promise<User[]> {
    return this.userRepository.findByRole(role);
  }

  async update(id: string, dto: Partial<User>): Promise<User> {
    return this.userRepository.update(id, dto);
  }

  async delete(id: string): Promise<boolean> {
    return this.userRepository.delete(id);
  }

  async activate(id: string): Promise<User> {
    return this.userRepository.activate(id);
  }

  async deactivate(id: string): Promise<User> {
    return this.userRepository.deactivate(id);
  }

  async getAnalytics() {
    const all = await this.userRepository.findAll();
    const roles = ['ADMIN', 'BACKOFFICE_MANAGER', 'BACKOFFICE_ANALYST', 'CLIENT', 'SUPPORT'];
    
    return {
      total: all.length,
      active: all.filter(u => u.isActive).length,
      inactive: all.filter(u => !u.isActive).length,
      byRole: roles.reduce((acc, role) => {
        acc[role] = all.filter(u => u.role === role).length;
        return acc;
      }, {}),
    };
  }
}
