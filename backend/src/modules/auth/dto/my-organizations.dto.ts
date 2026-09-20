export class MyOrganizationDto {
  organizationId!: string;
  organizationName!: string;
  role!: string;
  roleId!: string;
  isActive!: boolean;
}

export class MyOrganizationsResponseDto {
  organizations!: MyOrganizationDto[];
}

export class SwitchOrganizationResponseDto {
  organizationId!: string;
  organizationName!: string;
  role!: string;
  roleId!: string;
}
