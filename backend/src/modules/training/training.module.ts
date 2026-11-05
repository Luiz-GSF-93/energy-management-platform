import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TrainingController} from './training.controller';
import {TrainingService} from './training.service';
@Module({imports:[ConfigModule],controllers:[TrainingController],providers:[SupabaseService,TrainingService]})
export class TrainingModule{}
