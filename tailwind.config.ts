import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fdf4ff',
          100: '#fae8ff',
          200: '#f3d0fe',
          300: '#e9a8fd',
          400: '#d946ef',
          500: '#c026d3',
          600: '#a21caf',
          700: '#86198f',
          800: '#701a75',
          900: '#4a044e',
        },
        accent: {
          orange: '#f97316',
          yellow: '#facc15',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        heading: ['Cal Sans', 'Inter', 'sans-serif'],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: '72ch',
          },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
