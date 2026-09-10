import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

@Injectable()
export class SupabaseService {
  private supabaseClient: any;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');
    }

    // Usar "ws" para Node.js 20 (sem WebSocket nativo)
    this.supabaseClient = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseKey || 'placeholder-key',
      {
        realtime: {
          transport: ws as any, // Usar ws para Realtime
        },
      }
    );
  }

  getClient() {
    return this.supabaseClient;
  }
}
