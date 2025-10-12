import { fontFamily } from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{astro,ts,tsx}',
    './server/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', ...fontFamily.sans]
      },
      colors: {
        brand: {
          primary: '#4552FF',
          secondary: '#38BDF8'
        }
      },
      boxShadow: {
        floating: '0 10px 45px rgba(17, 24, 39, 0.18)'
      }
    }
  },
  plugins: []
};
