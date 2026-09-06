/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0B0F19',
          800: '#111827',
          700: '#1F2937',
          600: '#374151',
        },
        brand: {
          blue: '#3B82F6',
          green: '#10B981',
          red: '#EF4444',
          gold: '#F59E0B',
          purple: '#8B5CF6',
        }
      }
    },
  },
  plugins: [],
}
