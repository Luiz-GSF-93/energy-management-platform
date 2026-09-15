import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#59cbe8',
        secondary: '#1a1f2e',
        accent: '#00d4ff',
        'expert-bg': '#0f172a',
        'expert-card': '#1a1f2e',
      },
      fontFamily: {
        quivera: ['Quivera', 'sans-serif'],
        voyager: ['Voyager', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
