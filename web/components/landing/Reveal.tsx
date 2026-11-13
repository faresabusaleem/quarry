"use client";

// Entrances for the landing page: elements marked data-reveal rise into place once, as their
// section scrolls in, staggered within each section. Content is visible without script (the
// hidden start state only applies once this has run), and reduced motion skips the travel.
// Also forwards old shared links (/?run=<id>) to the app.

import { useEffect } from "react";

export function Reveal() {
  useEffect(() => {
    const run = new URLSearchParams(window.location.search).get("run");
    if (run && /^[a-z0-9]+$/i.test(run)) {
      window.location.replace(`/app/?run=${run}`);
      return;
    }
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    items.forEach((el) => {
      const section = el.closest("section, header, footer");
      const siblings = section ? Array.from(section.querySelectorAll("[data-reveal]")) : [el];
      el.style.setProperty("--reveal-delay", `${Math.min(siblings.indexOf(el), 6) * 80}ms`);
    });
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
