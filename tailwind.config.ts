import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        mint: {
          50: '#F0FDF9',
          100: '#C2EDD8',
          200: '#82DDC8',
        },
        coral: {
          500: '#FF8562',
          600: '#FF7048',
        },
      },
    },
  },
  plugins: [],
};
export default config;
