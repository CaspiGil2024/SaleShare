/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Class-based (not media-query-based) so a user's explicit toggle
  // choice (ThemeProvider, src/theme/ThemeProvider.jsx) always wins over
  // their OS preference, and persists via localStorage regardless of it.
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
