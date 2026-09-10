import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabaseClient: any;

  constructor(private configService: ConfigService) {
    const supabaseUrl = (this.configService.get('SUPABASE_URL') || '') as string;
    const supabaseKey = (this.configService.get('SUPABASE_SERVICE_KEY') || '') as string;
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ Supabase credentials not fully configured');
    }
    
    this.supabaseClient = createClient(supabaseUrl, supabaseKey);
  }

  getClient() {
    return this.supabaseClient;
  }
}
