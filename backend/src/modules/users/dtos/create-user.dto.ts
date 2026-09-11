export class CreateUserDto {
  name: string;
  email: string;
  password: string;
  role?: string;
}

export class UpdateUserDto {
  name?: string;
  bio?: string;
  avatar?: string;
}

export class AssignRoleDto {
  userId: string;
  role: string;
}
