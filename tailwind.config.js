/** Tidak ada tailwind.config di HTML. Play CDN memakai tema bawaan Tailwind 3. */
module.exports = {
  content: ["./*.{html,js,mjs}"],
  safelist: [
    "shadow-[0_-8px_24px_-16px_rgba(49,46,129,0.45)]",
    "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
  ],
  theme: { extend: {} },
  plugins: []
};
