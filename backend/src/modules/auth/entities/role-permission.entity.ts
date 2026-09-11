import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { UserRole } from '../enums/role.enum';
import { Permission } from '../enums/permission.enum';

@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ type: 'enum', enum: Permission })
  permission: Permission;
}
