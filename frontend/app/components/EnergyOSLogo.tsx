import Image from 'next/image';

/** Local SVG assets; the light lettering keeps the supplied logo legible on dark surfaces. */
export default function EnergyOSLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <Image src={compact ? '/brand/energyos-symbol.svg' : '/brand/energyos-logo-dark.svg'}
    alt="EnergyOS" width={compact ? 256 : 760} height={compact ? 256 : 200}
    className={className} priority />;
}
