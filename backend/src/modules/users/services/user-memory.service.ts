import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserMemoryService {
  private users = [
    { 
      id: '1', 
      email: 'admin@expertenergy.com.br', 
      // Senha hasheada (ainda é $2b$10$... mas segura)
      passwordHash: '$2b$10$rKf4PrcT0Jv.XxPR8BTfz.f4LPZWg1BpMp2CKM9eKJx5xtZUKdm5G', // Admin@2026! hasheada
      role: 'ADMIN', 
      name: 'Administrador' 
    },
    // ... outros usuários
  ];

  async findByEmail(email: string) {
    return this.users.find(u => u.email === email);
  }

  async findById(id: string) {
    return this.users.find(u => u.id === id);
  }

  async validatePassword(plainPassword: string, hashedPassword: string) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }
}
