/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#070f1e',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
        },
        access: {
          feasible: '#15803d',     // Green: Verified Feasible
          constrained: '#d97706',  // Amber/Orange: Constrained / Bottleneck
          infeasible: '#dc2626',   // Red: Infeasible / Impassable
          unknown: '#64748b',      // Slate: Unknown / Unmeasured
        }
      }
    },
  },
  plugins: [],
}
