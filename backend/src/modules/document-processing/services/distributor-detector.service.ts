import { Injectable } from '@nestjs/common';
import { Distributor } from '../enums/distributor.enum';

@Injectable()
export class DistributorDetectorService {
  private readonly patterns: Record<Distributor, RegExp[]> = {
    [Distributor.CPFL]: [
      /CPFL Energia/i,
      /Companhia Paulista de Força e Luz/i,
      /cpfl\.com\.br/i,
    ],
    [Distributor.ENERGISA]: [
      /Energisa/i,
      /energisa\.com\.br/i,
    ],
    [Distributor.ENEL]: [
      /ENEL/i,
      /Enel Distribuição/i,
      /enel\.com\.br/i,
    ],
    [Distributor.NEOENERGIA]: [
      /Neoenergia/i,
      /neoenergia\.com\.br/i,
    ],
    [Distributor.EQUATORIAL]: [
      /Equatorial/i,
      /equatorialenergia\.com\.br/i,
    ],
    [Distributor.CEMIG]: [
      /CEMIG/i,
      /cemig\.com\.br/i,
    ],
    [Distributor.LIGHT]: [
      /Light Energia/i,
      /light\.com\.br/i,
    ],
    [Distributor.AES]: [
      /AES/i,
      /aes\.com\.br/i,
    ],
    [Distributor.COPEL]: [
      /COPEL/i,
      /copel\.com\.br/i,
    ],
    [Distributor.ELETROPAULO]: [
      /Eletropaulo/i,
      /eletropaulo\.com\.br/i,
    ],
    [Distributor.GENERIC]: [/./], // Always matches as fallback
  };

  detectDistributor(text: string): Distributor {
    // Testa cada distribuidor exceto GENERIC
    for (const distributor of Object.values(Distributor)) {
      if (distributor === Distributor.GENERIC) continue;
      const patterns = this.patterns[distributor];
      if (!patterns) continue;
      
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return distributor;
        }
      }
    }
    return Distributor.GENERIC;
  }
}
