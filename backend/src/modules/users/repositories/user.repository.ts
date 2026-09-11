import { Injectable } from '@nestjs/common';
import { IRepository } from '../../../common/interfaces/repository.interface';

export interface User {
  id: string;
  email: string;
  password: string;
  role: string;
  name: string;
  tenant_id: string;
  tenant_name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UserRepository implements IRepository<User> {
  private users: Map<string, User> = new Map();
  private idCounter = 1;

  constructor() {
    this.initializeDefaultUsers();
  }

  private initializeDefaultUsers() {
    const defaultUsers: User[] = [
      {
        id: '1',
        email: 'admin@expertenergy.com.br',
        password: 'Admin@2026!',
        role: 'ADMIN',
        name: 'Administrador',
        tenant_id: 'tenant_default',
        tenant_name: 'Expert Energy',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        email: 'gerente@expertenergy.com.br',
        password: 'Gerente@2026!',
        role: 'BACKOFFICE_MANAGER',
        name: 'Gerente',
        tenant_id: 'tenant_default',
        tenant_name: 'Expert Energy',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '3',
        email: 'analista@expertenergy.com.br',
        password: 'Analista@2026!',
        role: 'BACKOFFICE_ANALYST',
        name: 'Analista',
        tenant_id: 'tenant_default',
        tenant_name: 'Expert Energy',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '4',
        email: 'teste@expertenergy.com.br',
        password: 'ExpertEnergy@2026!',
        role: 'CLIENT',
        name: 'Cliente',
        tenant_id: 'tenant_default',
        tenant_name: 'Expert Energy',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '5',
        email: 'suporte@expertenergy.com.br',
        password: 'Suporte@2026!',
        role: 'SUPPORT',
        name: 'Suporte',
        tenant_id: 'tenant_default',
        tenant_name: 'Expert Energy',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    defaultUsers.forEach(user => {
      this.users.set(user.id, user);
      this.idCounter = Math.max(this.idCounter, parseInt(user.id) + 1);
    });
  }

  async create(entity: Partial<User>): Promise<User> {
    const id = String(this.idCounter++);
    const user: User = {
      id,
      email: entity.email || '',
      password: entity.password || '',
      role: entity.role || 'CLIENT',
      name: entity.name || '',
      tenant_id: entity.tenant_id || 'tenant_default',
      tenant_name: entity.tenant_name || 'Expert Energy',
      isActive: entity.isActive !== undefined ? entity.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const users = Array.from(this.users.values());
    return users.find(u => u.email === email) || null;
  }

  async findByRole(role: string): Promise<User[]> {
    const users = Array.from(this.users.values());
    return users.filter(u => u.role === role);
  }

  async update(id: string, entity: Partial<User>): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new Error('User not found');
    
    const updated = { ...user, ...entity, updatedAt: new Date() };
    this.users.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  async activate(id: string): Promise<User> {
    return this.update(id, { isActive: true });
  }

  async deactivate(id: string): Promise<User> {
    return this.update(id, { isActive: false });
  }
}
