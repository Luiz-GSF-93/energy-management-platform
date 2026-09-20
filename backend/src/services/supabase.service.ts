import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: any;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL') 
      || 'https://ygvukbovagyvjavocypr.supabase.co';
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY') 
      || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlndnVrYm92YWd5dmphdk9jeXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjcwMjc3NzEsImV4cCI6MjA0MjYwMzc3MX0.2vvVqhqw7-2kRVTHQvqrz8sPaKqmG5zF8pJ-vV9q_Uw';
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ SupabaseService inicializado com URL:', supabaseUrl);
  }

  getClient() {
    return this.supabase;
  }

  createAuthClient() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration unavailable');
    }

    return createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
}
