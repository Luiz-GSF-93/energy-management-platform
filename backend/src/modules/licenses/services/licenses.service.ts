import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';

export interface LicenseRecord {
  id: string;
  organization_id: string;
  license_type: string;
  documents_limit: number;
  documents_used: number | null;
  renewal_date: string;
  active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  status: string | null;
  max_consumer_units: number | null;
  document_management: boolean | null;
  advanced_analytics: boolean | null;
  report_generation: boolean | null;
  free_market_management: boolean | null;
  start_date: string | null;
  end_date: string | null;
}

@Injectable()
export class LicensesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async resolveEffectiveLicense(
    organizationId: string,
    today = new Date().toISOString().slice(0, 10),
  ): Promise<LicenseRecord | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('licenses')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('active', true);

    if (error) {
      throw new InternalServerErrorException(
        'Unable to resolve effective license',
      );
    }

    const candidates = ((data ?? []) as LicenseRecord[]).filter((license) => {
      if (license.organization_id !== organizationId) return false;
      if (license.active !== true) return false;
      if (license.status?.toLowerCase() !== 'active') return false;
      if (!license.start_date) return false;
      if (license.start_date > today) return false;
      if (license.end_date !== null && license.end_date < today) return false;

      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length !== 1) {
      throw new InternalServerErrorException(
        'Ambiguous effective license state',
      );
    }

    return candidates[0];
  }
}
