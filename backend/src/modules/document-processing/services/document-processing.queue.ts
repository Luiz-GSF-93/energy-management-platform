import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Injectable()
export class DocumentProcessingQueueService {
  constructor(@InjectQueue('document-processing') private queue: Queue) {}

  async addToQueue(documentData: any) {
    console.log('📨 Adicionando documento à fila de processamento...');
    
    const job = await this.queue.add(
      {
        documentId: documentData.documentId,
        filePath: documentData.filePath,
        organizationId: documentData.organizationId,
      },
      {
        delay: 0,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
      },
    );

    console.log(`✅ Documento adicionado à fila com Job ID: ${job.id}`);
    return job;
  }

  async getQueueStatus() {
    const jobCounts = await this.queue.getJobCounts();
    return {
      active: jobCounts.active,
      completed: jobCounts.completed,
      failed: jobCounts.failed,
      delayed: jobCounts.delayed,
      waiting: jobCounts.waiting,
    };
  }
}
