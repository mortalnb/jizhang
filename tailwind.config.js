/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0a0b0d', // 深邃墨黑
          card: '#14161d', // 玻璃卡片底色
          surface: '#1c1f26', // 二级表面色
          text: '#f3f4f6', // 主要文字
          muted: '#9ca3af', // 次要灰字
        },
        brand: {
          cyan: '#00f2fe', // 极光青色
          purple: '#7f00ff', // 渐变紫色
          blue: '#4facfe', // 渐变蓝色
          neon: '#a855f7', // 亮紫色
          rose: '#ff0844', // 预警霓虹红
          orange: '#f59e0b', // 警告黄橙
          success: '#10b981', // 安全绿色
        }
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s infinite',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '0.6', boxShadow: '0 0 15px rgba(0, 242, 254, 0.2)' },
          '50%': { opacity: '1', boxShadow: '0 0 25px rgba(0, 242, 254, 0.5)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}
