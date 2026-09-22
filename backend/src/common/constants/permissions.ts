/**
 * Mapeamento de Permissões da Plataforma
 * UUIDs armazenados em roles.permissions (JSONB)
 * 
 * ⚠️ IMPORTANTE: Estes são os UUIDs reais armazenados no Supabase
 * Cada role tem um array destes UUIDs em sua coluna permissions
 */

export const PERMISSIONS = {
  // Energia - Comparison
  ENERGIA_COMPARISON_CALCULATE: '01f492b3-37a8-4279-90f0-2634c216ed38',
  
  // Operação - PLD
  OPERACAO_PLD_SYNC: '09b06b9d-7c76-45ab-8b0a-af97032cc179',
  
  // Operação - Requests
  OPERACAO_REQUESTS_VIEW: '1479c0b7-9608-4e95-bd83-7e6899255a78',
  
  // Settings - Profile
  SETTINGS_PROFILE_UPDATE: '185e100d-55dd-49dd-8b59-f490ad855250',
  
  // Settings - Security
  SETTINGS_SECURITY_MANAGE: '244bd3a1-c101-46d9-b1b2-5aa11f5dbd91',
  
  // Energia - Invoices
  ENERGIA_INVOICES_UPDATE: '285c9219-2260-4360-ba44-e38fc4d63606',
  ENERGIA_INVOICES_DELETE: '2da43e9b-96da-4b2d-a40a-1879da904c1d',
  
  // Organization - Users
  ORGANIZATION_USERS_CREATE: '3b6c523f-df37-4f72-9473-507aaefe1a26',
  
  // Documents - Reports
  DOCUMENTS_REPORTS_VIEW: '3ebadd32-6f30-459e-8ed3-0d2843d89946',
  
  // Settings - Appearance
  SETTINGS_APPEARANCE_MANAGE: '42a4e411-5fbc-4043-955e-a5078d2affb6',
  
  // Intelligence - AI
  INTELLIGENCE_AI_MANAGE: '463f336b-1d29-4cc4-a94c-4a75ce6b22df',
  
  // Operação - Events
  OPERACAO_EVENTS_VIEW: '489e6387-d5fc-4cb0-81f9-d7a76269dca5',
  
  // Organization - Users
  ORGANIZATION_USERS_DELETE: '4c53c778-69c6-4994-b12f-c74a6867ca63',
  
  // Settings - Notifications
  SETTINGS_NOTIFICATIONS_MANAGE: '51da7cca-8196-4135-84ce-f989be5ee594',
  
  // Documents - Archive
  DOCUMENTS_ARCHIVE_MANAGE: '52fa1d34-4cb2-4310-b800-518b35b8fdd3',
  
  // Organization - Licenses
  ORGANIZATION_LICENSES_UPDATE: '5a645f0d-8c70-42c2-b7d6-631371d3a613',
  
  // Organization - Users
  ORGANIZATION_USERS_UPDATE: '5f91d918-8def-4bc1-b6c7-37e1ff2d14e2',
  
  // Organization - Contracts
  ORGANIZATION_CONTRACTS_VIEW: '60f9690a-145b-4dba-b23f-9f945baca296',
  
  // Intelligence - AI
  INTELLIGENCE_AI_USE: '62443ab1-9187-42e4-a932-a7cf54f76250',
  
  // Settings - Profile
  SETTINGS_PROFILE_VIEW: '65f6d4e5-98d3-49e2-ac19-514639255c48',
  
  // Energia - Savings
  ENERGIA_SAVINGS_VIEW: '68ff98b9-3672-43b0-a9a0-5ececd4d7f50',
  
  // Energia - Indicators
  ENERGIA_INDICATORS_VIEW: '69c639bf-8ce2-40f0-a6f4-2c12c79bf29d',
  
  // Platform - Organizations
  PLATFORM_ORGANIZATIONS_CREATE: '6f62969b-1a2d-4adc-a784-2f49cba40dd5',
  
  // Operação - Calendar
  OPERACAO_CALENDAR_MANAGE: '6da45eb4-810c-4e40-9933-d9cda66a8841',
  
  // Operação - PLD
  OPERACAO_PLD_MANAGE: '83319b58-422e-4687-8a6e-9c7659d41ab8',
  
  // Organization - Licenses
  ORGANIZATION_LICENSES_VIEW: '8c5673e4-115c-4ab7-bb11-3b410eddcad3',
  
  // Documents - Documents
  DOCUMENTS_VIEW: '8f105b02-4443-49de-b188-847e0284e7ed',
  DOCUMENTS_UPLOAD: '8f3ff5eb-157a-468a-91af-6f89d92e23a7',
  
  // Energia - OCR
  ENERGIA_OCR_PROCESS: '92e1b670-ab10-483a-b825-c6e16799496d',
  
  // Organization - Users
  ORGANIZATION_USERS_INVITE: '94f57d38-0438-43c5-81bc-5544ab53912a',
  
  // Documents - Reports
  DOCUMENTS_REPORTS_CREATE: '9541a7bb-c20a-4c4d-9f4c-2185262c8e9c',
  
  // Operação - PLD
  OPERACAO_PLD_VIEW: '966188be-1b54-4594-bcd1-596ba5ac8fde',
  
  // Platform - Organizations
  PLATFORM_ORGANIZATIONS_VIEW: '9a679254-bb1a-4353-9d17-cc2bd9eb5abd',
  
  // Energia - Comparison
  ENERGIA_COMPARISON_VIEW: 'a3890b5d-f765-496d-88eb-f6a07d0cb8a8',
  
  // Documents - Archive
  DOCUMENTS_ARCHIVE_VIEW: 'aa849947-9204-4261-9899-fdd9e1f305e3',
  
  // Energia - Invoices
  ENERGIA_INVOICES_CREATE: 'b53166b2-f3df-41cf-ab97-d1f1e8378afc',
  
  // Organization - Contracts
  ORGANIZATION_CONTRACTS_CREATE: 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce',
  
  // Organization - Contracts
  ORGANIZATION_CONTRACTS_DELETE: 'c62d4c4e-65c1-4fa1-99f1-e2ffa547c51b',
  
  // Organization - Licenses
  ORGANIZATION_LICENSES_CREATE: 'c8cf7769-bfe2-4383-b3e4-f45619724c50',
  
  // Operação - Calendar
  OPERACAO_CALENDAR_VIEW: 'cb949e2a-e01d-4cf0-8c69-6ca74fe4d627',
  
  // Operação - Requests
  OPERACAO_REQUESTS_MANAGE: 'd1f1b3be-a842-41e7-aeb1-45fefeb2f4c1',
  
  // Operação - Events
  OPERACAO_EVENTS_MANAGE: 'd617b0f0-0fba-42f8-8707-811070346ef0',
  
  // Organization - Contracts
  ORGANIZATION_CONTRACTS_UPDATE: 'fd8a932f-87c0-4f86-8389-9f30c50e95b7',
  ORGANIZATION_CUSTOMERS_CREATE: 'ac18624a-9fc7-49a1-9680-9a4cf47ec492',
  ORGANIZATION_CUSTOMERS_DELETE: 'e1bf3b47-8a50-47e2-b8ec-a5a4aa402baa',
  ORGANIZATION_CUSTOMERS_UPDATE: '0f80e33b-bb78-4f3d-9f75-22b7977ef885',
  ORGANIZATION_CUSTOMERS_VIEW: 'cbb2e904-0718-4eec-9396-dba899118cdd',
  
  // Organization - Users
  ORGANIZATION_USERS_VIEW: 'f60e405e-f120-4420-a563-691162504b15',
  
  // Platform - Organizations
  PLATFORM_ORGANIZATIONS_DELETE: 'ec993184-f4b7-4472-bcbf-395bc7a767bb',
  
  // Platform - Organizations
  PLATFORM_ORGANIZATIONS_UPDATE: 'ede45b9c-8af4-4b47-8490-9d386a3efb13',
  
  // Documents - Documents
  DOCUMENTS_DELETE: '74d07d80-c1ae-410e-9249-53b8351d251b',
  
  // Energia - Invoices
  ENERGIA_INVOICES_VIEW: 'ba7e965d-7768-489e-a66b-df7eba356847',
  // Documents - Documents
  DOCUMENTS_UPDATE: '613b71d0-67db-4761-9e11-61fdf63ac8d5',

  // Organization - Consumer Units
  ORGANIZATION_CONSUMER_UNITS_CREATE: '05613764-311a-4e71-ac99-475ad1dfe87a',
  ORGANIZATION_CONSUMER_UNITS_DELETE: 'ee519924-491c-4680-82ea-e199673f884d',
  ORGANIZATION_CONSUMER_UNITS_UPDATE: '0f2e539d-03f9-4168-bc8c-55ac3a371628',
  ORGANIZATION_CONSUMER_UNITS_VIEW: 'b142bd7b-05a3-45ee-befd-e593066c2775',
};

// Atalhos para módulos específicos
export const CUSTOMERS_PERMISSIONS = [
  PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW,
  PERMISSIONS.ORGANIZATION_CUSTOMERS_CREATE,
  PERMISSIONS.ORGANIZATION_CUSTOMERS_UPDATE,
  PERMISSIONS.ORGANIZATION_CUSTOMERS_DELETE,
];

export const DOCUMENTS_PERMISSIONS = [
  PERMISSIONS.DOCUMENTS_VIEW,
  PERMISSIONS.DOCUMENTS_UPLOAD,
  PERMISSIONS.DOCUMENTS_UPDATE,
  PERMISSIONS.DOCUMENTS_DELETE,
  PERMISSIONS.DOCUMENTS_REPORTS_VIEW,
  PERMISSIONS.DOCUMENTS_REPORTS_CREATE,
];

export const CONSUMER_UNITS_PERMISSIONS = [
  PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_VIEW,
  PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_CREATE,
  PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_UPDATE,
  PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_DELETE,
];

export type PermissionKey = keyof typeof PERMISSIONS;
