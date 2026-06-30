/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 這裡就是我們的高級感木質調調色盤
        'oatmeal': '#FBF9F6', // 暖燕麥白
        'walnut': '#2C221E',  // 深胡桃木
        'taupe': '#8C7E74',   // 暮光淺褐
        'sage': '#607264',    // 鼠尾草綠
      }
    },
  },
  plugins: [],
}