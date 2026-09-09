-- ============================================
-- EXTENSÕES
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ORGANIZAÇÕES E MULTI-TENANCY
-- ============================================

CREATE TABLE organizations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type VARCHAR(20) NOT NULL DEFAULT 'CLIENT' CHECK (type IN ('ADMIN', 'CLIENT')),
  name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),
  document VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_organizations_type ON organizations(type);
CREATE INDEX idx_organizations_deleted_at ON organizations(deleted_at);

-- ============================================
-- ENDEREÇOS
-- ============================================

CREATE TABLE addresses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL UNIQUE,
  street VARCHAR(255) NOT NULL,
  number VARCHAR(20) NOT NULL,
  complement VARCHAR(255),
  neighborhood VARCHAR(255) NOT NULL,
  city VARCHAR(255) NOT NULL,
  state VARCHAR(2) NOT NULL,
  zip_code VARCHAR(10) NOT NULL,
  country VARCHAR(2) DEFAULT 'BR',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- ============================================
-- USUÁRIOS E AUTENTICAÇÃO
-- ============================================

CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  auth_user_id UUID UNIQUE,
  organization_id TEXT NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  avatar TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' 
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION')),
  email_verified BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMP NULL,
  last_login_ip VARCHAR(45),
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(organization_id, email)
);

CREATE INDEX idx_users_organization_id ON users(organization_id);
CREATE INDEX idx_users_status ON users(status);

-- ============================================
-- ROLES
-- ============================================

CREATE TABLE roles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(organization_id, name)
);

CREATE INDEX idx_roles_organization_id ON roles(organization_id);

-- ============================================
-- PERMISSÕES
-- ============================================

CREATE TABLE permissions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  module VARCHAR(50) NOT NULL,
  resource VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(module, resource, action)
);

CREATE INDEX idx_permissions_module ON permissions(module);

-- ============================================
-- MANY-TO-MANY: Users-Roles
-- ============================================

CREATE TABLE user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- ============================================
-- MANY-TO-MANY: Roles-Permissions
-- ============================================

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- ============================================
-- CLIENTES
-- ============================================

CREATE TABLE customers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),
  document VARCHAR(20) NOT NULL,
  economic_group VARCHAR(255),
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(20),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PROSPECT', 'CHURN')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(organization_id, document)
);

CREATE INDEX idx_customers_organization_id ON customers(organization_id);
CREATE INDEX idx_customers_status ON customers(status);

-- ============================================
-- UNIDADES CONSUMIDORAS
-- ============================================

CREATE TABLE consumer_units (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  distributor VARCHAR(50) NOT NULL,
  consumer_unit_number VARCHAR(20) NOT NULL,
  installation_number VARCHAR(20),
  submarket VARCHAR(50),
  tariff_group VARCHAR(10) NOT NULL,
  tariff_modality VARCHAR(50) NOT NULL DEFAULT 'BLUE'
    CHECK (tariff_modality IN ('BLUE', 'GREEN', 'WHITE', 'CONVENTIONAL')),
  voltage VARCHAR(20),
  contracted_demand FLOAT DEFAULT 0,
  migration_date TIMESTAMP NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'MIGRATED', 'CHURN', 'SEASONAL')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(organization_id, consumer_unit_number)
);

CREATE INDEX idx_consumer_units_organization_id ON consumer_units(organization_id);
CREATE INDEX idx_consumer_units_customer_id ON consumer_units(customer_id);
CREATE INDEX idx_consumer_units_status ON consumer_units(status);

-- ============================================
-- CONTRATOS DE ENERGIA
-- ============================================

CREATE TABLE energy_contracts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  consumer_unit_id TEXT NOT NULL,
  supplier_id VARCHAR(255),
  contract_number VARCHAR(50) UNIQUE NOT NULL,
  contract_type VARCHAR(50) NOT NULL
    CHECK (contract_type IN ('ENERGY_PURCHASE', 'ENERGY_SALE', 'MANAGEMENT', 'INTERMEDIATION', 'OTHER')),
  energy_type VARCHAR(50) NOT NULL DEFAULT 'ENERGY'
    CHECK (energy_type IN ('ENERGY', 'ENERGY_POWER', 'POWER')),
  energy_source VARCHAR(50),
  contracted_volume_mwh FLOAT NOT NULL,
  current_price FLOAT NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  adjustment_index VARCHAR(50),
  adjustment_frequency VARCHAR(50) NOT NULL DEFAULT 'ANNUAL'
    CHECK (adjustment_frequency IN ('ANNUAL', 'SEMIANNUAL', 'QUARTERLY', 'MONTHLY', 'CUSTOM')),
  adjustment_date TIMESTAMP NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'APPROVED', 'PAUSED', 'TERMINATED', 'EXPIRED')),
  management_contract_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (consumer_unit_id) REFERENCES consumer_units(id) ON DELETE CASCADE
);

CREATE INDEX idx_energy_contracts_organization_id ON energy_contracts(organization_id);
CREATE INDEX idx_energy_contracts_customer_id ON energy_contracts(customer_id);
CREATE INDEX idx_energy_contracts_consumer_unit_id ON energy_contracts(consumer_unit_id);
CREATE INDEX idx_energy_contracts_status ON energy_contracts(status);

-- ============================================
-- HISTÓRICO DE PREÇOS CONTRATO
-- ============================================

CREATE TABLE contract_price_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contract_id TEXT NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NULL,
  price_per_mwh FLOAT NOT NULL,
  adjustment_index VARCHAR(50),
  adjustment_pct FLOAT,
  approved_by TEXT,
  approved_at TIMESTAMP NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (contract_id) REFERENCES energy_contracts(id) ON DELETE CASCADE
);

CREATE INDEX idx_contract_price_history_contract_id ON contract_price_history(contract_id);

-- ============================================
-- CONTRATOS DE GESTÃO
-- ============================================

CREATE TABLE management_contracts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  contract_number VARCHAR(50) UNIQUE NOT NULL,
  remuneration_model VARCHAR(50) NOT NULL
    CHECK (remuneration_model IN ('FIXED', 'HYBRID', 'PERFORMANCE', 'COMMISSION', 'TIERED')),
  fixed_fee_monthly FLOAT DEFAULT 0,
  savings_percentage FLOAT DEFAULT 0,
  savings_minimum_threshold FLOAT,
  savings_maximum_cap FLOAT,
  benchmark_model VARCHAR(100),
  benchmark_percentile FLOAT,
  penalty_for_underperformance FLOAT,
  bonus_threshold FLOAT,
  bonus_percentage FLOAT,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'APPROVED', 'PAUSED', 'TERMINATED', 'EXPIRED')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX idx_management_contracts_organization_id ON management_contracts(organization_id);

-- ============================================
-- DOCUMENTOS
-- ============================================

CREATE TABLE documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  consumer_unit_id TEXT NOT NULL,
  document_type VARCHAR(50) NOT NULL
    CHECK (document_type IN ('INVOICE_DISTRIBUTOR', 'INVOICE_SUPPLIER', 'CONTRACT_ENERGY', 'CONTRACT_MANAGEMENT', 'CCEE_SETTLEMENT', 'CCEE_CHARGES', 'TAX_DOCUMENT', 'COMPLIANCE_REPORT', 'OTHER')),
  reference_month TIMESTAMP NOT NULL,
  issue_date TIMESTAMP NULL,
  due_date TIMESTAMP NULL,
  original_filename VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  thumbnail_path VARCHAR(500),
  processing_status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
    CHECK (processing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'MANUAL_REVIEW')),
  ocr_status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
    CHECK (ocr_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  ocr_extracted_data JSONB,
  invoice_id TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (consumer_unit_id) REFERENCES consumer_units(id) ON DELETE CASCADE
);

CREATE INDEX idx_documents_organization_id ON documents(organization_id);
CREATE INDEX idx_documents_customer_id ON documents(customer_id);
CREATE INDEX idx_documents_document_type ON documents(document_type);
CREATE INDEX idx_documents_reference_month ON documents(reference_month);

-- ============================================
-- FATURAS
-- ============================================

CREATE TABLE invoices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  consumer_unit_id TEXT NOT NULL,
  reference_month TIMESTAMP NOT NULL,
  issue_date TIMESTAMP NOT NULL,
  due_date TIMESTAMP NOT NULL,
  invoice_number VARCHAR(50),
  total_amount FLOAT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('DRAFT', 'PENDING', 'RECEIVED', 'PROCESSING', 'APPROVED', 'DISPUTED', 'PAID')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (consumer_unit_id) REFERENCES consumer_units(id) ON DELETE CASCADE,
  UNIQUE(organization_id, consumer_unit_id, reference_month)
);

CREATE INDEX idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX idx_invoices_consumer_unit_id ON invoices(consumer_unit_id);
CREATE INDEX idx_invoices_reference_month ON invoices(reference_month);

-- ============================================
-- ITENS DE FATURA
-- ============================================

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id TEXT NOT NULL,
  category VARCHAR(50) NOT NULL
    CHECK (category IN ('ENERGY', 'DEMAND', 'TUSD', 'TE', 'TARIFF', 'TAX', 'CHARGE', 'PENALTY', 'INTEREST', 'SERVICE', 'CREDIT', 'OTHER')),
  subcategory VARCHAR(100),
  description VARCHAR(500) NOT NULL,
  quantity FLOAT NOT NULL,
  unit VARCHAR(20),
  unit_price FLOAT NOT NULL,
  amount FLOAT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- ============================================
-- CCEE
-- ============================================

CREATE TABLE ccee_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  consumer_unit_id TEXT NOT NULL,
  reference_month TIMESTAMP NOT NULL,
  settlement_round VARCHAR(50) NOT NULL DEFAULT 'CLOSED'
    CHECK (settlement_round IN ('PREVIEW', 'CLOSED', 'ADJUSTMENT_1', 'ADJUSTMENT_2', 'ADJUSTMENT_3', 'FINAL')),
  category_code VARCHAR(50) NOT NULL,
  energy_source VARCHAR(50),
  consumption_mwh FLOAT NOT NULL,
  price_per_mwh FLOAT,
  total_amount FLOAT NOT NULL,
  previous_amount FLOAT,
  adjustment_reason TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'LOCKED', 'PUBLISHED', 'DISPUTED')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (consumer_unit_id) REFERENCES consumer_units(id) ON DELETE CASCADE
);

CREATE INDEX idx_ccee_entries_organization_id ON ccee_entries(organization_id);
CREATE INDEX idx_ccee_entries_reference_month ON ccee_entries(reference_month);

-- ============================================
-- TARIFAS
-- ============================================

CREATE TABLE tariffs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  distributor VARCHAR(50) NOT NULL,
  tariff_group VARCHAR(10) NOT NULL,
  tariff_modality VARCHAR(50) NOT NULL,
  subgroup VARCHAR(50),
  component VARCHAR(50) NOT NULL,
  value FLOAT NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NULL,
  source VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tariffs_distributor ON tariffs(distributor);
CREATE INDEX idx_tariffs_tariff_group ON tariffs(tariff_group);

-- ============================================
-- HISTÓRICO DE CONSUMO
-- ============================================

CREATE TABLE consumption_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  consumer_unit_id TEXT NOT NULL,
  reference_month TIMESTAMP NOT NULL,
  energy_mwh FLOAT NOT NULL,
  demand_kw FLOAT NOT NULL,
  source VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (consumer_unit_id) REFERENCES consumer_units(id) ON DELETE CASCADE,
  UNIQUE(consumer_unit_id, reference_month)
);

CREATE INDEX idx_consumption_history_consumer_unit_id ON consumption_history(consumer_unit_id);

-- ============================================
-- APURAÇÃO MENSAL
-- ============================================

CREATE TABLE monthly_energy_settlements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  consumer_unit_id TEXT NOT NULL,
  reference_month TIMESTAMP NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  
  regulated_energy_cost FLOAT NOT NULL,
  regulated_demand_cost FLOAT NOT NULL,
  regulated_tusd_cost FLOAT NOT NULL,
  regulated_te_cost FLOAT NOT NULL,
  regulated_taxes FLOAT NOT NULL,
  regulated_other_costs FLOAT NOT NULL,
  regulated_total_cost FLOAT NOT NULL,
  
  acl_energy_cost FLOAT NOT NULL,
  acl_tusd_cost FLOAT NOT NULL,
  acl_ccee_cost FLOAT NOT NULL,
  acl_charges_cost FLOAT NOT NULL,
  acl_taxes FLOAT NOT NULL,
  acl_other_costs FLOAT NOT NULL,
  acl_total_cost FLOAT NOT NULL,
  
  gross_savings FLOAT NOT NULL,
  eligible_costs FLOAT NOT NULL,
  net_savings_base FLOAT NOT NULL,
  
  management_model VARCHAR(50),
  management_fixed_fee FLOAT NOT NULL,
  management_variable_fee FLOAT NOT NULL,
  management_total_fee FLOAT NOT NULL,
  
  customer_final_savings FLOAT NOT NULL,
  
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PROCESSING', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'CLOSED')),
  approved_by TEXT,
  approved_at TIMESTAMP NULL,
  published_at TIMESTAMP NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (consumer_unit_id) REFERENCES consumer_units(id) ON DELETE CASCADE,
  UNIQUE(organization_id, consumer_unit_id, reference_month, version)
);

CREATE INDEX idx_monthly_energy_settlements_organization_id ON monthly_energy_settlements(organization_id);
CREATE INDEX idx_monthly_energy_settlements_consumer_unit_id ON monthly_energy_settlements(consumer_unit_id);
CREATE INDEX idx_monthly_energy_settlements_reference_month ON monthly_energy_settlements(reference_month);

-- ============================================
-- GESTÃO DE HONORÁRIOS
-- ============================================

CREATE TABLE management_billings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  management_contract_id TEXT NOT NULL,
  reference_month TIMESTAMP NOT NULL,
  settlement_id TEXT,
  base_savings FLOAT NOT NULL,
  eligible_costs FLOAT NOT NULL,
  net_savings FLOAT NOT NULL,
  fixed_fee FLOAT,
  variable_fee FLOAT,
  total_billing FLOAT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'CALCULATED'
    CHECK (status IN ('CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'INVOICED', 'PAID', 'DISPUTED')),
  approved_by TEXT,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (management_contract_id) REFERENCES management_contracts(id) ON DELETE CASCADE
);

CREATE INDEX idx_management_billings_management_contract_id ON management_billings(management_contract_id);
CREATE INDEX idx_management_billings_reference_month ON management_billings(reference_month);

-- ============================================
-- AUDITORIA
-- ============================================

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  user_id TEXT,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  changes JSONB,
  timestamp TIMESTAMP DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_logs_organization_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);

-- ============================================
-- NOTIFICAÇÕES
-- ============================================

CREATE TABLE notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL
    CHECK (type IN ('ALERT', 'INFO', 'WARNING', 'ERROR', 'SUCCESS')),
  resource_type VARCHAR(100),
  resource_id VARCHAR(100),
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);

-- ============================================
-- TRIGGER PARA updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;

$$ language 'plpgsql';

-- ============================================
-- DADOS INICIAIS
-- ============================================

INSERT INTO organizations (id, type, name, document, email)
VALUES (
  'org-admin-001',
  'ADMIN',
  'Gestora de Energia',
  '00.000.000/0001-00',
  'admin@energy-management.com'
) ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, name, module, resource, action)
VALUES
  ('acl.dashboard.view', 'Ver Dashboard', 'acl', 'dashboard', 'view'),
  ('acl.customer.view', 'Ver Clientes', 'acl', 'customer', 'view'),
  ('acl.customer.create', 'Criar Cliente', 'acl', 'customer', 'create'),
  ('acl.customer.edit', 'Editar Cliente', 'acl', 'customer', 'edit'),
  ('acl.contract.view', 'Ver Contratos', 'acl', 'contract', 'view'),
  ('acl.contract.create', 'Criar Contrato', 'acl', 'contract', 'create'),
  ('acl.contract.edit', 'Editar Contrato', 'acl', 'contract', 'edit'),
  ('acl.invoice.view', 'Ver Faturas', 'acl', 'invoice', 'view'),
  ('acl.invoice.upload', 'Upload de Fatura', 'acl', 'invoice', 'upload'),
  ('acl.settlement.view', 'Ver Apurações', 'acl', 'settlement', 'view'),
  ('acl.settlement.approve', 'Aprovar Apuração', 'acl', 'settlement', 'approve'),
  ('acl.report.view', 'Ver Relatórios', 'acl', 'report', 'view'),
  ('acl.audit.view', 'Ver Auditoria', 'acl', 'audit', 'view')
ON CONFLICT DO NOTHING;

INSERT INTO roles (id, organization_id, name, is_system)
VALUES ('role-super-admin', 'org-admin-001', 'SUPER_ADMIN', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-super-admin', id FROM permissions
ON CONFLICT DO NOTHING;
