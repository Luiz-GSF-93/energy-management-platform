/** Small vector face inspired by the Expert Energy cyan orbital mark. */
import styles from './BotEnergyAvatar.module.css';
export default function BotEnergyAvatar({size=36}:{size?:number}){
 return <svg className={styles.avatar} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{display:'block',flexShrink:0}}>
  <circle cx="32" cy="32" r="31" fill="#101b2c"/>
  <path d="M30 3C13 5 4 18 4 33c0 16 12 28 28 28 13 0 25-9 28-23-6 11-16 17-28 17C18 55 10 45 10 32c0-12 7-22 20-29Z" fill="#54c5df"/>
  <path d="M18 20C23 8 41 6 51 17c10 11 6 29-8 36 13-3 20-14 18-27C58 8 36 0 23 10c-3 3-5 6-5 10Z" fill="#54c5df"/>
  <rect x="17" y="21" width="30" height="25" rx="9" fill="#182c42" stroke="#54c5df" strokeWidth="2"/>
  <path d="m33 12-5 8h5l-2 5 7-9h-5l2-4Z" fill="#54c5df"/>
  <g className={styles.eyes}>
   <rect x="23" y="29" width="6" height="7" rx="2.5" fill="#54c5df"/>
   <rect x="35" y="29" width="6" height="7" rx="2.5" fill="#54c5df"/>
   <circle cx="25" cy="31" r="1" fill="#eafaff"/>
   <circle cx="37" cy="31" r="1" fill="#eafaff"/>
  </g>
  <path d="M27 39q5 5 10 0" fill="none" stroke="#eafaff" strokeWidth="2" strokeLinecap="round"/>
 </svg>;
}
