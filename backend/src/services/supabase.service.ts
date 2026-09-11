import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

@Injectable()
export class SupabaseService {
  private supabaseClient: any;
  private supabaseServiceClient: any;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL') || '';
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || '';
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('⚠️ SUPABASE_URL or SUPABASE_ANON_KEY not configured');
    }

    this.supabaseClient = createClient(supabaseUrl, supabaseAnonKey, { realtime: { transport: ws as any } });
    this.supabaseServiceClient = createClient(supabaseUrl, supabaseServiceKey, { realtime: { transport: ws as any } });
  }

  getClient() {
    return this.supabaseClient;
  }

  getServiceClient() {
    return this.supabaseServiceClient;
  }
}
