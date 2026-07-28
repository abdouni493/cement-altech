/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // All colors now reference CSS variables so they adapt to light/dark mode
        cream: 'var(--color-cream)',
        vanilla: 'var(--color-vanilla)',
        gold: {
          DEFAULT: 'var(--color-gold)',
          light: 'var(--color-gold-light)',
          dark: 'var(--color-gold-dark)',
        },
        rose: {
          DEFAULT: 'var(--color-rose)',
          deep: 'var(--color-rose-deep)',
        },
        lavender: {
          DEFAULT: 'var(--color-lavender)',
          deep: 'var(--color-lavender-deep, #9333EA)',
        },
        chocolate: 'var(--color-chocolate)',
        caramel: 'var(--color-caramel)',
        pistachio: 'var(--color-pistachio)',
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          light: 'var(--text-light)',
        },
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      backgroundImage: {
        'gradient-hero': 'var(--gradient-hero)',
        'gradient-sidebar': 'var(--gradient-sidebar)',
        'gradient-card': 'var(--gradient-card)',
        'gradient-button': 'var(--gradient-button)',
        'gradient-rose': 'var(--gradient-rose)',
        'gradient-lavender': 'var(--gradient-lavender)',
        'gradient-mint': 'var(--gradient-mint)',
        'gradient-glass': 'var(--gradient-glass)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        hover: 'var(--shadow-hover)',
        gold: 'var(--shadow-gold)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};
