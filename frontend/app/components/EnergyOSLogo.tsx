'use client';
import {useUserEnvironment} from '@/app/providers/UserEnvironmentProvider';
import Image from 'next/image';

/** Color signature uses the original vector variant for each surface. */
export default function EnergyOSLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const {account}=useUserEnvironment();
  const horizontal=account?.preferences.theme==='light'?'/brand/energyos-logo-horizontal-color.svg':'/brand/energyos-logo-horizontal-color-dark.svg';
  return <Image src={compact ? '/brand/energyos-product-mark-micro.svg' : horizontal}
    alt="EnergyOS" width={compact ? 256 : 980} height={compact ? 256 : 230}
    className={className} priority />;
}
