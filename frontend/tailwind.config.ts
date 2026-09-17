import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Poppins', 'sans-serif'],
        body: ['Poppins', 'sans-serif']
      },
      colors: {
        blush: {
          50: '#fff8fc',
          100: '#ffeaf4',
          200: '#ffd8e9',
          300: '#ffc2dd',
          400: '#f5a7ca'
        },
        sky: {
          50: '#f5fbff',
          100: '#e9f7ff',
          200: '#d3edff',
          300: '#bbe3ff',
          400: '#96d2f4'
        },
        mint: {
          100: '#e8faf4',
          200: '#d0f3e8',
          300: '#b4eadb'
        }
      },
      boxShadow: {
        card: '0 14px 36px rgba(126, 149, 191, 0.18)',
        glow: '0 0 0 1px rgba(255,255,255,0.75), 0 16px 32px rgba(188, 145, 240, 0.22)'
      }
    }
  },
  plugins: []
} satisfies Config;
