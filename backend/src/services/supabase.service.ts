import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: any;
  private readonly logger = new Logger(SupabaseService.name);

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      // Valores padrão para produção segura
      const url = 'https://ygvukbovagyvjavocypr.supabase.co';
      const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlndnVrYm92YWd5dmphdk9jeXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjcwMjc3NzEsImV4cCI6MjA0MjYwMzc3MX0.2vvVqhqw7-2kRVTHQvqrz8sPaKqmG5zF8pJ-vV9q_Uw';
      
      this.logger.warn('⚠️ Usando valores padrão para Supabase (DEV MODE)');
      this.supabase = createClient(url, key);
    } else {
      this.logger.log('✅ Supabase inicializado com credenciais de produção');
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  getClient() {
    return this.supabase;
  }
}
